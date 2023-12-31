import { unified } from "unified";
import rehypeStringify from "rehype-stringify";
import { lowlight } from "lowlight/lib/core";
import { solidity } from "highlightjs-solidity";
import { highlightedTextClass } from "src/components/composed/Debugger/utils";
import { completeMultilineSpans } from "src/components/composed/Debugger/utils/source/htmlUtils";
import type {
  Source,
  SourceRange
} from "src/components/composed/Debugger/utils";

export function convertSourceToHtml({
  source,
  sourceRange
}: {
  source: Source;
  sourceRange: SourceRange;
}) {
  // DETERMINE WHERE TEXT IS HIGHLIGHTED AND MARK
  // for lines that are fully highlighted, we don't update them but mark it in
  // an array - for partially hightlighted lines, we add comment markers for
  // where spans will go later designating debugger highlighting - we mark
  // them here as comments so lowlight doesn't choke on html
  const { sourceWithHighlightedMarkings, fullyHighlightedLines } =
    markTextHighlighted(source, sourceRange);

  // ADD SYNTAX HIGHLIGHTING (HTML) AND BREAK INTO INDIVIDUAL LINES
  const sourceWithSyntaxHighlighting = addSyntaxHighlighting(
    sourceWithHighlightedMarkings
  ).split("\n");

  // COMPLETE LOWLIGHT'S HTML SINCE WE BROKE THE SOURCE INTO LINES
  // HACK: we need to detect where lowlight added spans for multiline stuff
  // and add more because we break the source into lines
  const sourceWithAddedSpans = completeMultilineSpans(
    sourceWithSyntaxHighlighting
  );

  // REPLACE OUR HIGHLIGHTING MARKERS WITH HTML
  // replace comment markers with spans denoting the debugger's highlighted text
  return replaceTextHighlightedMarkings({
    source: sourceWithAddedSpans,
    fullyHighlightedLines
  });
}

const textHighlightingBeginsMarker = ` /****truffle-debugger-highlight-begin****/`;
const textHighlightingEndsMarker = ` /****truffle-debugger-highlight-end****/`;
const closingSpan = `</span>`;
// lowlight wraps our markers in spans which we need to remove when we replace
// the markers with our spans for highlighting
const highlightJsCommentSpan = `<span class="hljs-comment">`;

export function markTextHighlighted(source: Source, sourceRange: SourceRange) {
  const fullyHighlightedLines = new Set<number>();
  const editedLines = source.contents.split("\n").map((line, index) => {
    if (line.length === 0) {
      return line;
    }
    const { start, end } = sourceRange;
    // HACK: at times the debugger returns values of `null` which can mean that
    // the source maps are bad - one case is where the end values are too large
    // for a given source - here we try to account for this by assuming it
    // goes until the end of the file
    if (
      source.id === sourceRange.source.id &&
      index >= start.line &&
      end.line === null
    ) {
      fullyHighlightedLines.add(index);
      return line;
    }
    // END HACK

    const lineHasHighlighting =
      source.id === sourceRange.source.id &&
      index >= start.line &&
      index <= end.line!;

    if (!lineHasHighlighting) return line;

    const wholeLineHighlighted =
      (lineHasHighlighting &&
        // the line is in the middle of a block highlighted section
        start.line < index &&
        index < end.line!) ||
      // just the current line is highlighted
      (index === start.line &&
        start.column === 0 &&
        end.column === line.length - 1) ||
      // this line is the start of block highlighting
      (index === start.line && start.column === 0 && index < end.line!) ||
      // this line is the last line of block highlighting
      (index === end.line! &&
        index > start.line &&
        end.column === line.length - 1);
    // if the whole line is highlighted, we'll add the highlighting later -
    // weird html issues occur when we add it here due to us breaking up the
    // html into lines, thus breaking multiline tags
    if (wholeLineHighlighted) {
      fullyHighlightedLines.add(index);
      return line;
    }

    let editedLine;
    // highlighting contained within a single line
    if (start.line === index && end.line === index) {
      const segments = [
        line.slice(0, start.column),
        line.slice(start.column, end.column!),
        line.slice(end.column!)
      ];
      editedLine =
        segments[0] +
        textHighlightingBeginsMarker +
        segments[1] +
        textHighlightingEndsMarker +
        segments[2];
    }
    // highlighting starting on the current line but ending on another
    if (start.line === index && end.line! > index) {
      const segments = [line.slice(0, start.column), line.slice(start.column)];
      editedLine =
        segments[0] +
        textHighlightingBeginsMarker +
        segments[1] +
        textHighlightingEndsMarker;
    }
    // highlighting started on a previous line but ending on the current one
    if (start.line < index && end.line === index) {
      const segments = [line.slice(0, end.column!), line.slice(end.column!)];
      editedLine =
        textHighlightingBeginsMarker +
        segments[0] +
        textHighlightingEndsMarker +
        segments[1];
    }
    return editedLine;
  });

  return {
    fullyHighlightedLines,
    sourceWithHighlightedMarkings: {
      ...source,
      contents: editedLines.join("\n")
    }
  };
}

lowlight.registerLanguage("solidity", solidity);
const processor = unified().use(rehypeStringify);

export function addSyntaxHighlighting(source: Source) {
  const highlighted = lowlight.highlight("solidity", source.contents);
  return processor.stringify(highlighted);
}

export function replaceTextHighlightedMarkings({
  source,
  fullyHighlightedLines
}: {
  source: string[];
  fullyHighlightedLines: Set<number>;
}) {
  return source.map((line, index) => {
    const highlightedTextTag = `<span class="${highlightedTextClass}">`;
    const closingTag = `</span>`;
    // wrap the entire thing if it is fully highlighted
    if (fullyHighlightedLines.has(index)) {
      return highlightedTextTag + line + "</span>";
    }
    // we need to add the space to make lowlight parse the comment correctly
    // as a comment as there are some cases where it marks it incorrectly
    return (
      line
        .replaceAll(
          " " +
            highlightJsCommentSpan +
            textHighlightingBeginsMarker.slice(1) +
            closingSpan,
          highlightedTextTag
        )
        .replaceAll(
          " " +
            highlightJsCommentSpan +
            textHighlightingEndsMarker.slice(1) +
            closingSpan,
          closingTag
        )
        // sometimes the markings don't get wrapped by lowlight for some reason
        // we replace the ones it missed here
        .replaceAll(textHighlightingBeginsMarker.slice(1), highlightedTextTag)
        .replaceAll(textHighlightingEndsMarker.slice(1), closingTag)
        .replace(/(?<!<span) /g, "&nbsp;")
    );
  });
}
