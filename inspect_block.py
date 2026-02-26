from pathlib import Path
import re

text = Path('web/drawScript.js').read_text(encoding='utf-8')
match = re.search(r"      if \(currentPath.length > 1\) \{\n([\s\S]*?)      }", text)
if not match:
    print('match not found')
else:
    print(match.group(0))
