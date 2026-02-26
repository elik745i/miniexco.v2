from pathlib import Path
import re

path = Path('web/drawScript.js')
text = path.read_text(encoding='utf-8')

pattern = re.compile(r"      if \(currentPath.length > 1\) {\r?\n[\s\S]*?      }\r?\n\r?\n", re.M)
replacement = """      if (currentPath.length > 1) {\n        const strip = buildPerspectiveStrip(currentPath, svgBounds);\n        if (strip && strip.outline.length >= 3) {\n          const pathElement = document.createElementNS(\"http://www.w3.org/2000/svg\", \"path\");\n          const outline = strip.outline;\n          let d = \"\";\n\n          for (let i = 0; i < outline.length; i++) {\n            const cmd = i === 0 ? \"M\" : \"L\";\n            d += `${cmd}${outline[i].x} ${outline[i].y} `;\n          }\n\n          d += \"Z\";\n          pathElement.setAttribute(\"d\", d.trim());\n          pathElement.setAttribute(\"fill\", \"#39ff88\");\n          pathElement.setAttribute(\"fill-opacity\", \"0.35\");\n          pathElement.setAttribute(\"stroke\", \"#39ff88\");\n          pathElement.setAttribute(\"stroke-width\", \"1.1\");\n          pathElement.setAttribute(\"stroke-linejoin\", \"round\");\n          pathElement.setAttribute(\"stroke-linecap\", \"round\");\n          pathElement.classList.add(\"drawn-path\");\n          svgOverlay.appendChild(pathElement);\n        }\n\n        const centerPolyline = document.createElementNS(\"http://www.w3.org/2000/svg\", \"polyline\");\n        centerPolyline.setAttribute(\"points\", currentPath.map(p => `${p.x},${p.y}`).join(\" \"));\n        centerPolyline.setAttribute(\"fill\", \"none\");\n        centerPolyline.setAttribute(\"stroke\", \"#39ff88\");\n        centerPolyline.setAttribute(\"stroke-width\", \"1\");\n        centerPolyline.setAttribute(\"stroke-linecap\", \"round\");\n        centerPolyline.setAttribute(\"stroke-linejoin\", \"round\");\n        centerPolyline.setAttribute(\"vector-effect\", \"non-scaling-stroke\");\n        centerPolyline.classList.add(\"drawn-path\");\n        svgOverlay.appendChild(centerPolyline);\n      }\n\n"""

new_text, count = pattern.subn(replacement, text)
if count != 1:
    raise SystemExit('renderPath drawing block not found or ambiguous')

path.write_text(new_text, encoding='utf-8')
