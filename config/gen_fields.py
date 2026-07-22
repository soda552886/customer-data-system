"""Generate fields_data.json from fields.js constants."""
import json
import re
from pathlib import Path

BASE = Path(__file__).parent
js = (BASE / 'fields.js').read_text(encoding='utf-8')


def extract_array(name):
    m = re.search(rf'const {name} = \[([\s\S]*?)\];', js)
    if not m:
        return []
    return re.findall(r"'([^']*)'", m.group(1))


def extract_staff():
    m = re.search(r'const SALES_STAFF = (\{[\s\S]*?\});', js)
    block = m.group(1)
    staff = {}
    for site, arr in re.findall(r"(\w+): \[([\s\S]*?)\]", block):
        staff[site] = re.findall(r"'([^']*)'", arr)
    return staff


constants = {}
for name in [
    'REGIONS', 'MEDIA', 'OCCUPATIONS', 'AGE_RANGES', 'BUDGET', 'ROOM_TYPES',
    'PRODUCT_OFFICE', 'PRODUCT_RESIDENTIAL',
    'FLOOR_OPTIONS', 'AREA_OPTIONS', 'NOT_PURCHASED', 'PURCHASED',
    'VISITOR_COUNT', 'VISITOR_RELATION', 'CUSTOMER_SOURCE', 'SINCERITY',
    'PURCHASE_PURPOSE', 'PURCHASE_MOTIVE', 'COMMERCIAL_PROJECTS',
    'VISIT_COUNT', 'RETURN_COUNT',
]:
    constants[name] = extract_array(name)

SALES_STAFF = extract_staff()

sections_raw = re.search(r'const FIELD_SECTIONS = (\[[\s\S]*\]);', js).group(1)
for k, v in constants.items():
    sections_raw = sections_raw.replace(k, json.dumps(v, ensure_ascii=False))

sections_raw = sections_raw.replace('true', 'true').replace('false', 'false')
# Convert JS object keys to JSON
sections_raw = re.sub(r'(\w+):', r'"\1":', sections_raw)
sections_raw = sections_raw.replace("'", '"')

sections_raw = re.sub(r',\s*([\]}])', r'\1', sections_raw)

sections = json.loads(sections_raw)

out = {'sections': sections, 'salesStaff': SALES_STAFF}
(BASE / 'fields_data.json').write_text(
    json.dumps(out, ensure_ascii=False, indent=2),
    encoding='utf-8',
)
print(f'Generated {len(sections)} sections')
