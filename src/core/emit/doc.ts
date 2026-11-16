import {
  emptyMap,
  emptySet,
  indices,
  reverseIndices,
  stackValues,
} from "../runtime.ts";
// The printer of the emitter: an indentation-aware
// text builder in the style of Wadler and Prettier. The emitter builds a `Doc`
// tree. `render` lays the tree out at a fixed width with one fixed style.
//
// A `span` node tags a part of the output with a source span. `render` returns
// the generated range of each tag. The span table and the source map
// are built from these ranges. A `mark` node tags a part of the output with a
// key, for the ranges that have no source span, such as a host assertion.
import type { Span } from "../ir.ts";
export type Doc = string | readonly Doc[] | {
  readonly k: "line";
  readonly soft: boolean;
  readonly hard: boolean;
  /** A hard line that a fit test passes: it measures the next line as well. */
  readonly through: boolean;
} | {
  readonly k: "group";
  readonly d: Doc;
  readonly brk: boolean;
  readonly id: GroupId | undefined;
} | {
  readonly k: "ifbroke";
  readonly id: GroupId;
  readonly broken: Doc;
  readonly flat: Doc;
} | {
  readonly k: "indent";
  readonly d: Doc;
} | {
  readonly k: "ifbreak";
  readonly broken: Doc;
  readonly flat: Doc;
} | {
  readonly k: "alt";
  readonly options: readonly Doc[];
} | {
  readonly k: "iffits";
  readonly probe: Doc;
  readonly whenFits: Doc;
  readonly otherwise: Doc;
} | {
  readonly k: "span";
  readonly span: Span;
  readonly d: Doc;
} | {
  readonly k: "endspan";
  readonly span: Span;
  readonly start: number;
} | {
  readonly k: "mark";
  readonly data: HostAssertionData;
  readonly d: Doc;
} | {
  readonly k: "endmark";
  readonly data: HostAssertionData;
  readonly start: number;
} | {
  readonly k: "fill";
  readonly parts: readonly Doc[];
  readonly tail: number;
} | {
  readonly k: "fillstep";
  readonly fill: FillDoc;
  readonly i: number;
} | {
  readonly k: "spanopen";
  readonly span: Span;
  readonly id: GroupId;
} | {
  readonly k: "spanclose";
  readonly span: Span;
  readonly id: GroupId;
};
type FillDoc = Extract<Doc, {
  readonly k: "fill";
}>;
/** Names a group, so that a later `ifBroke` can ask whether the group broke. */
export type GroupId = object;
export type LayoutBreak = boolean;
/** A space when flat and a newline when broken. */
export const line: Doc = {
  k: "line",
  soft: false,
  hard: false,
  through: false,
};
/** Nothing when flat and a newline when broken. */
export const soft: Doc = { k: "line", soft: true, hard: false, through: false };
/** Always a newline. A group that contains it always breaks. */
export const hard: Doc = { k: "line", soft: false, hard: true, through: false };
/**
 * Always a newline, like `hard`. A fit test of an `alt` option does not stop
 * at it. The test goes on with the next line, at its indentation.
 */
export const through: Doc = {
  k: "line",
  soft: false,
  hard: true,
  through: true,
};
export function group(
  d: Doc,
  requestedBreak: LayoutBreak | undefined,
  id: GroupId | undefined,
): Doc {
  const brk = requestedBreak ?? false;
  return { k: "group", d: d, brk: brk, id: id };
}
/**
 * `broken` when the group named `id` was laid out in break mode, else `flat`.
 * The group must come before this node in the output.
 */
export function ifBroke(
  id: GroupId,
  broken: Doc,
  requestedFlat: Doc | undefined,
): Doc {
  const flat = requestedFlat ?? "";
  return { k: "ifbroke", id: id, broken: broken, flat: flat };
}
/** Tags the output of `d` with host assertion data. `render` returns its generated range. */
export function marked(data: HostAssertionData, d: Doc): Doc {
  return { k: "mark", data: data, d: d };
}
export function indent(d: Doc): Doc {
  return { k: "indent", d: d };
}
export function ifBreak(broken: Doc, requestedFlat: Doc | undefined): Doc {
  const flat = requestedFlat ?? "";
  return { k: "ifbreak", broken: broken, flat: flat };
}
/**
 * A choice between layouts, as the conditional group of Prettier. The printer
 * tries each option in order and keeps the first whose first line fits. The
 * last option is printed in break mode.
 */
export function alt(options: readonly Doc[]): Doc {
  return { k: "alt", options: options };
}
/**
 * `whenFits` when `probe` fits, else `otherwise`. The printer measures `probe`
 * in flat mode at the current position and indentation, without the text that
 * follows the node, and prints nothing for it. A `through` line in `probe`
 * restarts the measure at the indentation of the next line. The chosen branch
 * is printed in the current mode.
 */
export function ifFits(probe: Doc, whenFits: Doc, otherwise: Doc): Doc {
  return {
    k: "iffits",
    probe: probe,
    whenFits: whenFits,
    otherwise: otherwise,
  };
}
export type IndentLevel = number;
/**
 * A greedy fill: `parts` alternate content, separator, content, and so on. The
 * printer puts the next content on the current line when the separator and the
 * content fit there, else it breaks the separator. The first content stays on
 * the current line. The separators and the contents after the first sit
 * `tail` indentation levels deeper.
 */
export function fill(parts: readonly Doc[], tail: IndentLevel): Doc {
  return { k: "fill", parts: parts, tail: tail };
}
/**
 * The two ends of a span that covers a part of a `fill` and no whole node.
 * The opening end comes first in the output, the closing end after it.
 */
export type SpanEnds = {
  readonly open: Doc;
  readonly close: Doc;
};
export function spanEnds(span: Span): SpanEnds {
  const id: GroupId = {};
  return {
    open: { k: "spanopen", span: span, id: id },
    close: { k: "spanclose", span: span, id: id },
  };
}
/** Tags the output of `d` with a source span. */
export function spanned(span: Span, d: Doc): Doc {
  return { k: "span", span: span, d: d };
}
export function join(separator: Doc, docs: readonly Doc[]): Doc {
  const out: Doc[] = [];
  for (const i of indices(docs.length)) {
    const d = docs[i];
    if (i > 0) {
      const _appendTarget1 = out;
      const _appendValue2 = separator;
      _appendTarget1[_appendTarget1.length] = _appendValue2;
    }
    {
      const _appendTarget3 = out;
      const _appendValue4 = d;
      _appendTarget3[_appendTarget3.length] = _appendValue4;
    }
  }
  return out;
}
/** A braced statement list. An empty list prints `{}`. */
export function braces(statements: readonly Doc[]): Doc {
  if (statements.length === 0) {
    return "{}";
  }
  return ["{", indent([hard, join(hard, statements)]), hard, "}"];
}
/** A comma list in brackets: one line when it fits, else one item for each line with a trailing comma. */
export function bracketed(
  open: BracketText,
  close: BracketText,
  items: readonly Doc[],
  padded: Padding,
): Doc {
  if (items.length === 0) {
    return open + close;
  }
  const edge = padded ? line : soft;
  return group(
    [
      open,
      indent([edge, join([",", line], items)]),
      ifBreak(",", undefined),
      edge,
      close,
    ],
    undefined,
    undefined,
  );
}
export type BracketText = string;
export type Padding = boolean;
/** A call with one argument: `callee(arg)` when it fits, else the argument on a line of its own with a trailing comma. */
export function callWith(callee: Doc, arg: Doc): Doc {
  return [
    callee,
    group(
      ["(", indent([soft, arg]), ifBreak(",", undefined), soft, ")"],
      undefined,
      undefined,
    ),
  ];
}
/**
 * Keep a declaration's value beside `=` when its opening fits. When
 * `typeBreaks` is true and the prefix is too long for its own line, the type
 * in the prefix breaks and the value follows its last line.
 */
export function assignment(
  prefix: Doc,
  value: Doc,
  requestedTypeBreaks: LayoutBreak | undefined,
): Doc {
  const typeBreaks = requestedTypeBreaks ?? false;
  const below: Doc = [prefix, " =", indent([hard, value])];
  return alt([
    ifFits(
      [prefix, " = ", group(value, true, undefined), ";"],
      [prefix, " = ", value],
      typeBreaks
        ? ifFits([prefix, " ="], below, [prefix, " = ", value])
        : below,
    ),
  ]);
}
/** A field or parameter whose value moves below a long label. */
export function property(label: Doc, value: Doc): Doc {
  const inline: Doc = [label, ": ", value];
  return ifBreak(
    alt([
      ifFits([label, ": ", group(value, true, undefined), ","], inline, [
        label,
        ":",
        indent([hard, value]),
      ]),
    ]),
    inline,
  );
}
export type MemberName = string;
/** A member access or call that breaks before the dot when its head is wide. */
export function member(
  base: Doc,
  name: MemberName,
  requestedTail: Doc | undefined,
): Doc {
  const tail = requestedTail ?? "";
  if (tail === "") {
    return group([base, indent([soft, ".", name])], undefined, undefined);
  }
  const inline: Doc = [base, ".", name, tail];
  const afterBase = indent([hard, ".", name, tail]);
  const dot = typeof base === "string" ? base.indexOf(".") : -1;
  const broken: Doc = typeof base === "string" && dot > 0
    ? ifFits(base, [base, afterBase], [
      base.slice(0, dot),
      indent([hard, base.slice(dot), ".", name, tail]),
    ])
    : [base, afterBase];
  return group(
    ifBreak(
      alt([
        ifFits([base, ".", name, group(tail, true, undefined)], inline, broken),
      ]),
      inline,
    ),
    undefined,
    undefined,
  );
}
export type SpanRecord = {
  /** Offsets in UTF-16 code units of the rendered text. The end is exclusive. */
  readonly start: number;
  readonly end: number;
  readonly span: Span;
};
/**
 * What a host assertion constant says about itself: the data of its mark. The
 * range of the constant comes from `render`.
 */
export type HostAssertionData = {
  /** The name of the assertion constant: `UsersLive$host`. */
  readonly name: string;
  /** The name that the Effektive source binds in its import: `UsersLive`. */
  readonly local: string;
  /** The name that the host module exports. */
  readonly exported: string;
  /** The registry key: `providers` for `host:providers`. */
  readonly key: string;
};
type MarkRecord = {
  readonly data: HostAssertionData;
  readonly start: number;
  readonly end: number;
};
type Rendered = {
  readonly text: string;
  /** In the order in which the tagged parts close. */
  readonly spans: readonly SpanRecord[];
  /** In the order in which the marked parts close. */
  readonly marks: readonly MarkRecord[];
};
const INDENT_WIDTH = 2;
type Mode = "flat" | "break";
type Cmd = {
  readonly indent: number;
  readonly mode: Mode;
  readonly doc: Doc;
};
function isText(doc: Doc): doc is string {
  return typeof doc === "string";
}
function isList(doc: Doc): doc is readonly Doc[] {
  return Array.isArray(doc);
}
/** True when `doc` holds a hard line outside an `alt`. Memoized by object identity. */
function makeHardCheck(): (doc: Doc) => boolean {
  let memo = emptyMap<object, boolean>();
  function check(doc: Doc): boolean {
    if (isText(doc)) {
      return false;
    }
    const key: object = doc;
    const known = memo.get(key);
    if (known !== undefined) {
      return known;
    }
    let result = false;
    if (isList(doc)) {
      result = doc.some(check);
    } else {
      if (doc.k === "line") result = doc.hard;
      if (doc.k === "group") result = doc.brk || check(doc.d);
      if (doc.k === "indent" || doc.k === "span" || doc.k === "mark") {
        result = check(doc.d);
      }
      if (doc.k === "ifbreak" || doc.k === "ifbroke") {
        result = check(doc.broken) || check(doc.flat);
      }
      // A hard line inside an option does not force the group to break.
      if (doc.k === "alt") result = false;
      // The probe prints nothing, so only the two branches count.
      if (doc.k === "iffits") {
        result = check(doc.whenFits) || check(doc.otherwise);
      }
      if (doc.k === "fill") result = doc.parts.some(check);
    }
    memo = memo.set(key, result);
    return result;
  }
  return check;
}
export type HardLinePresence = boolean;
/**
 * True when `doc` holds a hard line, or a group that must break, outside an
 * `alt`. A fit test of an `alt` option stops at such a line.
 */
export function hasHardLine(doc: Doc): HardLinePresence {
  return makeHardCheck()(doc);
}
export type RenderWidth = number;
export function render(
  doc: Doc,
  requestedWidth: RenderWidth | undefined,
): Rendered {
  const width = requestedWidth ?? 80;
  const hasHard = makeHardCheck();
  const out: string[] = [];
  const spans: SpanRecord[] = [];
  const marks: MarkRecord[] = [];
  /** The groups that were laid out in break mode. */
  let broke = emptySet<GroupId>();
  let column = 0;
  let offset = 0;
  let remeasure = false;
  /** The output offsets at which the open ends of fill spans were printed. */
  let openSpans = emptyMap<GroupId, number>();
  const stack: Cmd[] = [{ indent: 0, mode: "break", doc: doc }];
  function fits(next: Cmd, rest: readonly Cmd[], room: number): boolean {
    const cmds: Cmd[] = [...rest, next];
    let left = room;
    for (const cmd of stackValues(cmds)) {
      if (left < 0) return false;
      const d = cmd.doc;
      if (isText(d)) {
        left = left - d.length;
      } else if (isList(d)) {
        for (const i of reverseIndices(d.length)) {
          {
            const _appendTarget7 = cmds;
            const _appendValue8 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: d[i],
            };
            _appendTarget7[_appendTarget7.length] = _appendValue8;
          }
        }
      } else {
        if (d.k === "line") {
          if (d.through && cmd.mode === "flat") {
            left = width - cmd.indent;
            continue;
          }
          if (cmd.mode === "break" || d.hard) {
            return true;
          }
          if (!d.soft) {
            left = left - 1;
          }
          continue;
        }
        if (d.k === "group") {
          {
            const mode: Mode = d.brk || hasHard(d.d) ? "break" : cmd.mode;
            {
              const _appendTarget9 = cmds;
              const _appendValue10 = {
                indent: cmd.indent,
                mode: mode,
                doc: d.d,
              };
              _appendTarget9[_appendTarget9.length] = _appendValue10;
            }
            continue;
          }
        }
        if (d.k === "indent") {
          {
            const _appendTarget11 = cmds;
            const _appendValue12 = {
              indent: cmd.indent + INDENT_WIDTH,
              mode: cmd.mode,
              doc: d.d,
            };
            _appendTarget11[_appendTarget11.length] = _appendValue12;
          }
          continue;
        }
        if (d.k === "span" || d.k === "mark") {
          {
            const _appendTarget13 = cmds;
            const _appendValue14 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: d.d,
            };
            _appendTarget13[_appendTarget13.length] = _appendValue14;
          }
          continue;
        }
        if (d.k === "fill") {
          for (const i of reverseIndices(d.parts.length)) {
            {
              const _appendTarget15 = cmds;
              const _appendValue16 = {
                indent: i === 0
                  ? cmd.indent
                  : cmd.indent + INDENT_WIDTH * d.tail,
                mode: cmd.mode,
                doc: d.parts[i],
              };
              _appendTarget15[_appendTarget15.length] = _appendValue16;
            }
          }
          continue;
        }
        if (d.k === "fillstep") {
          if (d.i < d.fill.parts.length) {
            return true;
          }
          continue;
        }
        if (d.k === "spanopen" || d.k === "spanclose") {
          continue;
        }
        if (d.k === "ifbroke") {
          {
            const _appendTarget17 = cmds;
            const _appendValue18 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: broke.has(d.id) ? d.broken : d.flat,
            };
            _appendTarget17[_appendTarget17.length] = _appendValue18;
          }
          continue;
        }
        if (d.k === "ifbreak") {
          {
            const _appendTarget19 = cmds;
            const _appendValue20 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: cmd.mode === "break" ? d.broken : d.flat,
            };
            _appendTarget19[_appendTarget19.length] = _appendValue20;
          }
          continue;
        }
        if (d.k === "alt") {
          {
            const _appendTarget21 = cmds;
            const _appendValue22 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: cmd.mode === "break"
                ? d.options[d.options.length - 1]
                : d.options[0],
            };
            _appendTarget21[_appendTarget21.length] = _appendValue22;
          }
          continue;
        }
        if (d.k === "iffits") {
          {
            const _appendTarget23 = cmds;
            const _appendValue24 = {
              indent: cmd.indent,
              mode: cmd.mode,
              doc: fits(
                  { indent: cmd.indent, mode: "flat", doc: d.probe },
                  [],
                  left,
                )
                ? d.whenFits
                : d.otherwise,
            };
            _appendTarget23[_appendTarget23.length] = _appendValue24;
          }
          continue;
        }
        if (d.k === "endspan" || d.k === "endmark") {
          continue;
        }
      }
    }
    return left >= 0;
  }
  function write(s: string): number {
    {
      const _appendTarget25 = out;
      const _appendValue26 = s;
      _appendTarget25[_appendTarget25.length] = _appendValue26;
    }
    column = column + s.length;
    return offset + s.length;
  }
  function newline(spaces: number): number {
    {
      const _appendTarget27 = out;
      const _appendValue28 = "\n" + " ".repeat(spaces);
      _appendTarget27[_appendTarget27.length] = _appendValue28;
    }
    column = spaces;
    return offset + 1 + spaces;
  }
  for (const cmd of stackValues(stack)) {
    const d = cmd.doc;
    if (isText(d)) {
      offset = write(d);
      continue;
    }
    if (isList(d)) {
      for (const i of reverseIndices(d.length)) {
        {
          const _appendTarget29 = stack;
          const _appendValue30 = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: d[i],
          };
          _appendTarget29[_appendTarget29.length] = _appendValue30;
        }
      }
      continue;
    }
    if (d.k === "line") {
      if (cmd.mode === "flat" && !d.hard) {
        if (!d.soft) {
          offset = write(" ");
        }
      } else {
        // Later groups must fit their new column, even when an outer command is flat.
        remeasure = true;
        offset = newline(cmd.indent);
      }
      continue;
    }
    if (d.k === "group") {
      {
        if (cmd.mode === "flat" && !remeasure) {
          const mode: Mode = d.brk || hasHard(d.d) ? "break" : "flat";
          if (mode === "break" && d.id !== undefined) {
            broke = broke.add(d.id);
          }
          {
            const _appendTarget31 = stack;
            const _appendValue32 = {
              indent: cmd.indent,
              mode: mode,
              doc: d.d,
            };
            _appendTarget31[_appendTarget31.length] = _appendValue32;
          }
          continue;
        }
        remeasure = false;
        const flat: Cmd = { indent: cmd.indent, mode: "flat", doc: d.d };
        const forced = d.brk || hasHard(d.d);
        if (!forced && fits(flat, stack, width - column)) {
          {
            const _appendTarget33 = stack;
            const _appendValue34 = flat;
            _appendTarget33[_appendTarget33.length] = _appendValue34;
          }
        } else {
          if (d.id !== undefined) {
            broke = broke.add(d.id);
          }
          {
            const _appendTarget35 = stack;
            const _appendValue36: Cmd = {
              indent: cmd.indent,
              mode: "break",
              doc: d.d,
            };
            _appendTarget35[_appendTarget35.length] = _appendValue36;
          }
        }
        continue;
      }
    }
    if (d.k === "ifbroke") {
      {
        const _appendTarget37 = stack;
        const _appendValue38 = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: broke.has(d.id) ? d.broken : d.flat,
        };
        _appendTarget37[_appendTarget37.length] = _appendValue38;
      }
      continue;
    }
    if (d.k === "indent") {
      {
        const _appendTarget39 = stack;
        const _appendValue40 = {
          indent: cmd.indent + INDENT_WIDTH,
          mode: cmd.mode,
          doc: d.d,
        };
        _appendTarget39[_appendTarget39.length] = _appendValue40;
      }
      continue;
    }
    if (d.k === "fill") {
      {
        if (cmd.mode === "flat" && !remeasure) {
          {
            const _appendTarget41 = stack;
            const _appendValue42: Cmd = {
              indent: cmd.indent,
              mode: "flat",
              doc: d.parts,
            };
            _appendTarget41[_appendTarget41.length] = _appendValue42;
          }
          continue;
        }
        remeasure = false;
        if (d.parts.length === 0) {
          continue;
        }
        {
          const _appendTarget43 = stack;
          const _appendValue44: Cmd = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: { k: "fillstep", fill: d, i: 1 },
          };
          _appendTarget43[_appendTarget43.length] = _appendValue44;
        }
        {
          const _appendTarget45 = stack;
          const _appendValue46 = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: group(d.parts[0], undefined, undefined),
          };
          _appendTarget45[_appendTarget45.length] = _appendValue46;
        }
        continue;
      }
    }
    if (d.k === "fillstep") {
      {
        const parts = d.fill.parts;
        if (d.i >= parts.length) {
          continue;
        }
        const separator = parts[d.i];
        const content = parts[d.i + 1];
        const lastContent = d.i + 1 === parts.length - 1;
        const deeper = cmd.indent + INDENT_WIDTH * d.fill.tail;
        const flatPair: Cmd = {
          indent: deeper,
          mode: "flat",
          doc: [separator, content],
        };
        const onLine = fits(flatPair, lastContent ? stack : [], width - column);
        {
          const _appendTarget47 = stack;
          const _appendValue48: Cmd = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: { k: "fillstep", fill: d.fill, i: d.i + 2 },
          };
          _appendTarget47[_appendTarget47.length] = _appendValue48;
        }
        {
          const _appendTarget49 = stack;
          const _appendValue50: Cmd = {
            indent: deeper,
            mode: "break",
            doc: group(content, undefined, undefined),
          };
          _appendTarget49[_appendTarget49.length] = _appendValue50;
        }
        {
          const _appendTarget51 = stack;
          const _appendValue52: Cmd = {
            indent: deeper,
            mode: onLine ? "flat" : "break",
            doc: separator,
          };
          _appendTarget51[_appendTarget51.length] = _appendValue52;
        }
        continue;
      }
    }
    if (d.k === "spanopen") {
      openSpans = openSpans.set(d.id, offset);
      continue;
    }
    if (d.k === "spanclose") {
      {
        const _appendTarget53 = spans;
        const _appendValue54 = {
          start: openSpans.get(d.id) ?? offset,
          end: offset,
          span: d.span,
        };
        _appendTarget53[_appendTarget53.length] = _appendValue54;
      }
      continue;
    }
    if (d.k === "ifbreak") {
      {
        const _appendTarget55 = stack;
        const _appendValue56 = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: cmd.mode === "break" ? d.broken : d.flat,
        };
        _appendTarget55[_appendTarget55.length] = _appendValue56;
      }
      continue;
    }
    if (d.k === "iffits") {
      {
        const _appendTarget57 = stack;
        const _appendValue58 = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: fits(
              { indent: cmd.indent, mode: "flat", doc: d.probe },
              [],
              width - column,
            )
            ? d.whenFits
            : d.otherwise,
        };
        _appendTarget57[_appendTarget57.length] = _appendValue58;
      }
      continue;
    }
    if (d.k === "alt") {
      {
        const options = d.options;
        const last = options[options.length - 1];
        if (cmd.mode === "flat" && !remeasure) {
          {
            const _appendTarget59 = stack;
            const _appendValue60: Cmd = {
              indent: cmd.indent,
              mode: "flat",
              doc: options[0],
            };
            _appendTarget59[_appendTarget59.length] = _appendValue60;
          }
          continue;
        }
        remeasure = false;
        const first: Cmd = {
          indent: cmd.indent,
          mode: "flat",
          doc: options[0],
        };
        if (fits(first, stack, width - column)) {
          {
            const _appendTarget61 = stack;
            const _appendValue62 = first;
            _appendTarget61[_appendTarget61.length] = _appendValue62;
          }
          continue;
        }
        let chosen: Cmd | undefined;
        for (const candidateIndex of indices(options.length - 2)) {
          const i = candidateIndex + 1;
          const candidate: Cmd = {
            indent: cmd.indent,
            mode: "flat",
            doc: options[i],
          };
          if (fits(candidate, stack, width - column)) {
            chosen = candidate;
            break;
          }
        }
        {
          const _appendTarget63 = stack;
          const _appendValue64 = chosen ??
            { indent: cmd.indent, mode: "break", doc: last };
          _appendTarget63[_appendTarget63.length] = _appendValue64;
        }
        continue;
      }
    }
    if (d.k === "span") {
      {
        const _appendTarget65 = stack;
        const _appendValue66: Cmd = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: { k: "endspan", span: d.span, start: offset },
        };
        _appendTarget65[_appendTarget65.length] = _appendValue66;
      }
      {
        const _appendTarget67 = stack;
        const _appendValue68 = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: d.d,
        };
        _appendTarget67[_appendTarget67.length] = _appendValue68;
      }
      continue;
    }
    if (d.k === "endspan") {
      {
        const _appendTarget69 = spans;
        const _appendValue70 = { start: d.start, end: offset, span: d.span };
        _appendTarget69[_appendTarget69.length] = _appendValue70;
      }
      continue;
    }
    if (d.k === "mark") {
      {
        const _appendTarget71 = stack;
        const _appendValue72: Cmd = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: { k: "endmark", data: d.data, start: offset },
        };
        _appendTarget71[_appendTarget71.length] = _appendValue72;
      }
      {
        const _appendTarget73 = stack;
        const _appendValue74 = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: d.d,
        };
        _appendTarget73[_appendTarget73.length] = _appendValue74;
      }
      continue;
    }
    if (d.k === "endmark") {
      {
        const _appendTarget75 = marks;
        const _appendValue76 = { data: d.data, start: d.start, end: offset };
        _appendTarget75[_appendTarget75.length] = _appendValue76;
      }
      continue;
    }
  }
  return { text: out.join(""), spans: spans, marks: marks };
}
