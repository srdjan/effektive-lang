// The grammar of a cron expression and the rules of a cron time zone. Both
// mirror `Cron.parse` and `DateTime.zoneFromString` of effect@4.0.5, so a
// value that passes here is a value that `Cron.parseUnsafe` accepts. The
// checker and the validator both call these functions. This module imports no
// checker or validator code.

interface FieldRules {
  readonly min: number;
  readonly max: number;
  readonly aliases?: ReadonlyMap<string, number>;
}

const names = (list: string): ReadonlyMap<string, number> => {
  const words = list.split(" ");
  const first = list.startsWith("jan") ? 1 : 0;
  return new Map(words.map((word, index) => [word, index + first]));
};

const FIELDS: readonly { readonly name: string; readonly rules: FieldRules }[] =
  [
    { name: "seconds", rules: { min: 0, max: 59 } },
    { name: "minutes", rules: { min: 0, max: 59 } },
    { name: "hours", rules: { min: 0, max: 23 } },
    { name: "days", rules: { min: 1, max: 31 } },
    {
      name: "months",
      rules: {
        min: 1,
        max: 12,
        aliases: names("jan feb mar apr may jun jul aug sep oct nov dec"),
      },
    },
    {
      name: "weekdays",
      rules: {
        min: 0,
        max: 7,
        aliases: names("sun mon tue wed thu fri sat"),
      },
    },
  ];

const DECIMAL = /^\d+$/;

function valueOf(text: string, rules: FieldRules): number {
  const alias = rules.aliases?.get(text.toLowerCase());
  if (alias !== undefined) return alias;
  return DECIMAL.test(text) ? Number(text) : Number.NaN;
}

function itemProblem(item: string, rules: FieldRules): string | undefined {
  const slash = item.indexOf("/");
  const raw = slash === -1 ? item : item.slice(0, slash);
  if (slash !== -1) {
    const text = item.slice(slash + 1);
    const step = DECIMAL.test(text) ? Number(text) : Number.NaN;
    if (!Number.isInteger(step)) return "a step must be a positive integer";
    if (step < 1) return "a step must be greater than 0";
    if (step > rules.max) {
      return `a step must be at most ${rules.max}`;
    }
  }
  if (raw === "*") return undefined;
  const dash = raw.indexOf("-");
  const left = valueOf(dash === -1 ? raw : raw.slice(0, dash), rules);
  if (!Number.isInteger(left)) return "a value must be a positive integer";
  if (left < rules.min || left > rules.max) {
    return `a value must be between ${rules.min} and ${rules.max}`;
  }
  if (dash === -1) return undefined;
  const right = valueOf(raw.slice(dash + 1), rules);
  if (!Number.isInteger(right)) return "a value must be a positive integer";
  if (right < rules.min || right > rules.max) {
    return `a value must be between ${rules.min} and ${rules.max}`;
  }
  if (left > right) return "a range must not run backward";
  return undefined;
}

/** The reason that a cron expression is invalid, or undefined when it is valid. */
export function cronExpressionProblem(text: string): string | undefined {
  const segments = text.trim().split(/\s+/).filter((part) => part !== "");
  if (segments.length !== 5 && segments.length !== 6) {
    return "a cron expression has 5 or 6 fields";
  }
  const fields = segments.length === 5 ? ["0", ...segments] : segments;
  for (let index = 0; index < FIELDS.length; index++) {
    const { name, rules } = FIELDS[index];
    for (const item of fields[index].split(",")) {
      const problem = itemProblem(item, rules);
      if (problem !== undefined) return `field ${name}: ${problem}`;
    }
  }
  return undefined;
}

const OFFSET_ZONE_PREFIX = /^(?:GMT|[+-])/;
const OFFSET_ZONE_END = /([+-])(\d{2}):(\d{2})$/;

/** The reason that a time zone is invalid, or undefined when it is valid. */
export function cronZoneProblem(zone: string): string | undefined {
  if (OFFSET_ZONE_PREFIX.test(zone)) {
    return OFFSET_ZONE_END.test(zone)
      ? undefined
      : "an offset zone must end with +hh:mm or -hh:mm";
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return undefined;
  } catch {
    return "the time zone is not known";
  }
}
