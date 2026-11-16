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
      out[out.length] = separator;
    }
    out[out.length] = d;
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
          cmds[cmds.length] = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: d[i],
          };
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
            cmds[cmds.length] = {
              indent: cmd.indent,
              mode: mode,
              doc: d.d,
            };
            continue;
          }
        }
        if (d.k === "indent") {
          cmds[cmds.length] = {
            indent: cmd.indent + INDENT_WIDTH,
            mode: cmd.mode,
            doc: d.d,
          };
          continue;
        }
        if (d.k === "span" || d.k === "mark") {
          cmds[cmds.length] = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: d.d,
          };
          continue;
        }
        if (d.k === "fill") {
          for (const i of reverseIndices(d.parts.length)) {
            cmds[cmds.length] = {
              indent: i === 0 ? cmd.indent : cmd.indent + INDENT_WIDTH * d.tail,
              mode: cmd.mode,
              doc: d.parts[i],
            };
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
          cmds[cmds.length] = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: broke.has(d.id) ? d.broken : d.flat,
          };
          continue;
        }
        if (d.k === "ifbreak") {
          cmds[cmds.length] = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: cmd.mode === "break" ? d.broken : d.flat,
          };
          continue;
        }
        if (d.k === "alt") {
          cmds[cmds.length] = {
            indent: cmd.indent,
            mode: cmd.mode,
            doc: cmd.mode === "break"
              ? d.options[d.options.length - 1]
              : d.options[0],
          };
          continue;
        }
        if (d.k === "iffits") {
          cmds[cmds.length] = {
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
    out[out.length] = s;
    column = column + s.length;
    return offset + s.length;
  }
  function newline(spaces: number): number {
    out[out.length] = "\n" + " ".repeat(spaces);
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
        stack[stack.length] = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: d[i],
        };
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
          stack[stack.length] = {
            indent: cmd.indent,
            mode: mode,
            doc: d.d,
          };
          continue;
        }
        remeasure = false;
        const flat: Cmd = { indent: cmd.indent, mode: "flat", doc: d.d };
        const forced = d.brk || hasHard(d.d);
        if (!forced && fits(flat, stack, width - column)) {
          stack[stack.length] = flat;
        } else {
          if (d.id !== undefined) {
            broke = broke.add(d.id);
          }
          stack[stack.length] = {
            indent: cmd.indent,
            mode: "break",
            doc: d.d,
          };
        }
        continue;
      }
    }
    if (d.k === "ifbroke") {
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: broke.has(d.id) ? d.broken : d.flat,
      };
      continue;
    }
    if (d.k === "indent") {
      stack[stack.length] = {
        indent: cmd.indent + INDENT_WIDTH,
        mode: cmd.mode,
        doc: d.d,
      };
      continue;
    }
    if (d.k === "fill") {
      {
        if (cmd.mode === "flat" && !remeasure) {
          stack[stack.length] = {
            indent: cmd.indent,
            mode: "flat",
            doc: d.parts,
          };
          continue;
        }
        remeasure = false;
        if (d.parts.length === 0) {
          continue;
        }
        stack[stack.length] = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: { k: "fillstep", fill: d, i: 1 },
        };
        stack[stack.length] = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: group(d.parts[0], undefined, undefined),
        };
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
        stack[stack.length] = {
          indent: cmd.indent,
          mode: cmd.mode,
          doc: { k: "fillstep", fill: d.fill, i: d.i + 2 },
        };
        stack[stack.length] = {
          indent: deeper,
          mode: "break",
          doc: group(content, undefined, undefined),
        };
        stack[stack.length] = {
          indent: deeper,
          mode: onLine ? "flat" : "break",
          doc: separator,
        };
        continue;
      }
    }
    if (d.k === "spanopen") {
      openSpans = openSpans.set(d.id, offset);
      continue;
    }
    if (d.k === "spanclose") {
      spans[spans.length] = {
        start: openSpans.get(d.id) ?? offset,
        end: offset,
        span: d.span,
      };
      continue;
    }
    if (d.k === "ifbreak") {
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: cmd.mode === "break" ? d.broken : d.flat,
      };
      continue;
    }
    if (d.k === "iffits") {
      stack[stack.length] = {
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
      continue;
    }
    if (d.k === "alt") {
      {
        const options = d.options;
        const last = options[options.length - 1];
        if (cmd.mode === "flat" && !remeasure) {
          stack[stack.length] = {
            indent: cmd.indent,
            mode: "flat",
            doc: options[0],
          };
          continue;
        }
        remeasure = false;
        const first: Cmd = {
          indent: cmd.indent,
          mode: "flat",
          doc: options[0],
        };
        if (fits(first, stack, width - column)) {
          stack[stack.length] = first;
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
        stack[stack.length] = chosen ??
          { indent: cmd.indent, mode: "break", doc: last };
        continue;
      }
    }
    if (d.k === "span") {
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: { k: "endspan", span: d.span, start: offset },
      };
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: d.d,
      };
      continue;
    }
    if (d.k === "endspan") {
      spans[spans.length] = { start: d.start, end: offset, span: d.span };
      continue;
    }
    if (d.k === "mark") {
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: { k: "endmark", data: d.data, start: offset },
      };
      stack[stack.length] = {
        indent: cmd.indent,
        mode: cmd.mode,
        doc: d.d,
      };
      continue;
    }
    if (d.k === "endmark") {
      marks[marks.length] = { data: d.data, start: d.start, end: offset };
      continue;
    }
  }
  return { text: out.join(""), spans: spans, marks: marks };
}
