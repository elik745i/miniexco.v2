from pathlib import Path
import re

path = Path('web/drawScript.js')
text = path.read_text(encoding='utf-8')

pattern = re.compile(r"^  function applyPerspectiveToPoint\(point, bounds\) {\n.*?^  window\\.toggleDrawMode = function\(\) {", re.S | re.M)
new_prefix = "  window.toggleDrawMode = function() {"
text, count = pattern.subn(new_prefix, text)
if count != 1:
    raise SystemExit('Failed to drop legacy perspective functions')

path.write_text(text, encoding='utf-8')
