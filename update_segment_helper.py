from pathlib import Path
import re

path = Path('web/drawScript.js')
text = path.read_text(encoding='utf-8')

pattern = re.compile(r"  function strokePerspectiveSegment\(ctxRef, start, end, bounds\) {\n    if \(!ctxRef || !start || !end\) return;\n    const avgY = \(\(start.y \?\? 0\) \+ \(end.y \?\? 0\)\) / 2;\n    ctxRef.lineWidth = getPerspectiveWidth\(avgY, bounds\);\n    ctxRef.beginPath\(\);\n    ctxRef.moveTo\(start.x, start.y\);\n    ctxRef.lineTo\(end.x, end.y\);\n    ctxRef.stroke\(\);\n  }\n\n")
replacement = "  function strokePerspectiveSegment(ctxRef, start, end, bounds) {\n    if (!ctxRef || !start || !end) return;\n    const startY = typeof start.y === \"number\" ? start.y : 0;\n    const endY = typeof end.y === \"number\" ? end.y : 0;\n    const avgY = (startY + endY) / 2;\n    ctxRef.lineWidth = getPerspectiveWidth(avgY, bounds);\n    ctxRef.beginPath();\n    ctxRef.moveTo(start.x, start.y);\n    ctxRef.lineTo(end.x, end.y);\n    ctxRef.stroke();\n  }\n\n"
text, count = pattern.subn(replacement, text)
if count != 1:
    raise SystemExit('Failed to update strokePerspectiveSegment')

path.write_text(text, encoding='utf-8')
