# -*- coding: utf-8 -*-
"""查看 JSON 中缺失角色的完整内容"""
import json, sys, io

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

JSON_PATH = r'C:\Users\HUAWEI\AppData\Local\Temp\codebuddy-dropped-files\a240e86a-401b-40b4-aa79-83c776027930\高校拟人OC_73位角色_2026-08-10.json'

with open(JSON_PATH, 'r', encoding='utf-8') as f:
    data = json.load(f)

for c in data:
    if c['姓名'] == '秦熠晖':
        for k, v in c.items():
            print(f'{k}: {v!r}')
        break
