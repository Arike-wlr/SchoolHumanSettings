# -*- coding: utf-8 -*-
"""统计口径两路验证 —— Python 侧：直接调 backend.get_stats() 取出新增/改动的指标。

⚠️ 不用 curl /api/stats 当基准（那是 live 服务，可能与当前代码不同步）。
   直接 import backend 调函数，拿的就是这份代码 + 当前 DB。

输出 .workbuddy/tmp_scan/py_stats.json 给 JS 侧比对。
"""
import io
import json
import os
import sys

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
sys.path.insert(0, os.path.join(ROOT, 'server'))

import backend  # noqa: E402

OUT = os.path.join(ROOT, '.workbuddy', 'tmp_scan', 'py_stats.json')


def main():
    s = backend.get_stats()
    hl = s['highlights']
    out = {
        'total_setting_chars': hl['total_setting_chars'],
        'longest_setting': hl['items']['longest_setting'],
        'setting_distribution': hl['setting_distribution'],
        'regions': [
            {'name': r['name'], 'avg_setting': r['avg_setting']} for r in s['regions']
        ],
        'char_total': s['characters']['total'],
    }
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with io.open(OUT, 'w', encoding='utf-8') as f:
        json.dump(out, f, ensure_ascii=False, indent=2)

    print('=== Python 侧（backend.get_stats）===')
    print('  角色数            ', out['char_total'])
    print('  全字段总字数      ', out['total_setting_chars'])
    ls = out['longest_setting']
    print('  最厚 Top5         ', [(x['name'], x['value']) for x in ls[:5]])
    print('  篇幅分布          ', [(d['name'], d['count']) for d in out['setting_distribution']])
    print('  地区设定厚度      ', [(r['name'], r['avg_setting']) for r in out['regions']][:6], '...')
    print('  已写出            ', OUT)
    return 0


if __name__ == '__main__':
    sys.exit(main())
