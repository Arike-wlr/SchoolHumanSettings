# -*- coding: utf-8 -*-
"""临时脚本：对比 JSON 文件与数据库角色内容"""
import sqlite3, json, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

JSON_PATH = r'C:\Users\HUAWEI\AppData\Local\Temp\codebuddy-dropped-files\a240e86a-401b-40b4-aa79-83c776027930\高校拟人OC_73位角色_2026-08-10.json'

# 读取 JSON
with open(JSON_PATH, 'r', encoding='utf-8') as f:
    json_data = json.load(f)
print('JSON 角色数量:', len(json_data))
print('JSON 字段:', list(json_data[0].keys()))
print()

# 字段映射（JSON 中文 -> 数据库字段）
FIELD_MAP = {
    '姓名': 'name',
    '别名': 'alias',
    '代表高校': 'university',
    '地区': 'region',
    '诞生地': 'birthplace',
    '存在状态': 'status',
    '性别': 'gender',
    '身高': 'height',
    '生日': 'birthday',
    '外貌': 'appearance',
    '身份存在时间': 'identity_period',
    '诞生时间': 'birth_time',
    '取名依据': 'naming_rationale',
    '设定': 'setting',
    '家族': 'family',
}

# 读取数据库
conn = sqlite3.connect('d:/Settings/server/oc_characters.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()
cur.execute('SELECT * FROM characters ORDER BY sort_order ASC, id ASC')
db_rows = cur.fetchall()

print('数据库角色数量:', len(db_rows))
print('数据库字段:', list(db_rows[0].keys()))
print()

# 按名字建立数据库索引
db_by_name = {}
for r in db_rows:
    d = dict(r)
    db_by_name[d['name']] = d

# 1. JSON 中有的角色但数据库没有
json_names = [c['姓名'] for c in json_data]
db_names = set(db_by_name.keys())

print('=== JSON 有但数据库没有的角色 ===')
for n in json_names:
    if n not in db_names:
        print('  [缺失]', n)
print()

print('=== 数据库有但 JSON 没有的角色 ===')
for n in db_names:
    if n not in json_names:
        print('  [多余]', n, '|', db_by_name[n].get('university', ''))
print()

# 2. 逐字段对比
print('=== 字段不一致的角色 ===')
for c in json_data:
    name = c['姓名']
    if name not in db_by_name:
        continue
    d = db_by_name[name]
    diffs = []
    for jk, dk in FIELD_MAP.items():
        jv = (c.get(jk) or '').strip()
        dv = (d.get(dk) or '').strip()
        if jv != dv:
            diffs.append(f'{dk}: [DB] {dv[:40]!r} vs [JSON] {jv[:40]!r}')
    if diffs:
        print(f'--- {name} ---')
        for dd in diffs:
            print('   ', dd)
