# -*- coding: utf-8 -*-
"""
导出手机版可用的备份包（给调试用）。

背景：手机版的「恢复」只在本地库为空时触发，且只认 App 私有目录的
files/data_backup.json，没法手动导入。要把电脑上的数据灌进浏览器/真机，
就需要一份「手机版备份格式」的 JSON。

本脚本从 server/oc_characters.db 导出这份 JSON，图片保持服务器 URL
（IMG 前缀 → http://<server>/images/xxx），体积小、可直接贴进控制台。

用法：
    .venv\\Scripts\\python.exe tools\\export-mock-backup.py
    .venv\\Scripts\\python.exe tools\\export-mock-backup.py --server http://localhost:8000
    .venv\\Scripts\\python.exe tools\\export-mock-backup.py --out .workbuddy/mock/mock.json
    .venv\\Scripts\\python.exe tools\\export-mock-backup.py --pretty     # 缩进输出

⚠️ 图片字段一律写成「服务器相对路径」（/images/xxx），手机版同步时
   resolveServerImageUrl 会自动拼上当前服务器地址。写绝对 URL 会在换端口后失效。
"""
import argparse
import datetime
import json
import os
import sqlite3
import sys

BASE = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
DEFAULT_DB = os.path.join(BASE, 'server', 'oc_characters.db')

# 手机版恢复时只用这三个块（见 db.js checkAndRestoreBackup）
CHAR_COLS_KEEP = [
    'id', 'name', 'alias', 'university', 'region', 'naming_rationale', 'height',
    'gender', 'birthday', 'appearance', 'identity_period', 'birth_time',
    'setting', 'family', 'birthplace', 'status', 'face_crop',
    'image_url', 'images', 'sort_order',
]


def norm_image_ref(ref):
    """把各种写法归一成 /images/<文件名>。"""
    s = str(ref or '').strip()
    if not s:
        return ''
    if s.startswith('data:'):
        return s                       # 已经是内嵌图片，保持原样
    if s.startswith('http://') or s.startswith('https://'):
        # 取路径部分，丢掉主机名 → 换服务器地址后仍可用
        from urllib.parse import urlsplit
        p = urlsplit(s).path
        return p if p.startswith('/') else '/' + p
    if s.startswith('/'):
        return s
    return '/images/' + s.lstrip('/')


def load_rows(db_path):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    chars = []
    for r in cur.execute('SELECT * FROM characters ORDER BY sort_order ASC, id ASC'):
        d = dict(r)
        # images 存的是 JSON 字符串，解成数组
        raw = d.get('images') or '[]'
        try:
            imgs = json.loads(raw)
            if not isinstance(imgs, list):
                imgs = []
        except (json.JSONDecodeError, TypeError):
            imgs = []
        if not imgs and d.get('image_url'):
            imgs = [d['image_url']]
        d['images'] = [x for x in (norm_image_ref(i) for i in imgs) if x]
        d['image_url'] = d['images'][0] if d['images'] else ''
        d.pop('images_raw', None)
        chars.append({k: d.get(k, '') for k in CHAR_COLS_KEEP if k in d})

    worlds = []
    for r in cur.execute('SELECT * FROM world_buildings ORDER BY sort_order ASC, id ASC'):
        d = dict(r)
        worlds.append({
            'id': d.get('id'),
            'title': d.get('title', ''),
            'category': d.get('category', ''),
            'main_category': d.get('main_category', ''),
            'content': d.get('content', ''),
            'sort_order': d.get('sort_order', 0),
        })

    rels = []
    cur.execute("""
        SELECT r.*, c1.name AS from_name, c2.name AS to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        ORDER BY r.sort_order ASC, r.id ASC
    """)
    for r in cur.fetchall():
        d = dict(r)
        rels.append({
            'id': d.get('id'),
            'from_char_id': d.get('from_char_id'),
            'to_char_id': d.get('to_char_id'),
            'from_name': d.get('from_name') or '',
            'to_name': d.get('to_name') or '',
            'relation_type': d.get('relation_type', ''),
            'description': d.get('description', ''),
            'sort_order': d.get('sort_order', 0),
        })

    conn.close()
    return chars, worlds, rels


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--db', default=DEFAULT_DB)
    ap.add_argument('--out', default=os.path.join(BASE, '.workbuddy', 'mock', 'mock-backup.json'))
    ap.add_argument('--pretty', action='store_true', help='缩进输出（体积变大，便于人工查看）')
    args = ap.parse_args()

    if not os.path.isfile(args.db):
        sys.stderr.write('找不到数据库：%s\n' % args.db)
        return 2

    chars, worlds, rels = load_rows(args.db)
    payload = {
        'version': 1,
        'savedAt': int(datetime.datetime.now().timestamp() * 1000),
        'source': 'export-mock-backup.py',
        'characters': chars,
        'worldBuildings': worlds,
        'relations': rels,
    }

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, indent=2 if args.pretty else None)
    with open(out, 'w', encoding='utf-8') as f:
        f.write(text)

    img_n = sum(len(c['images']) for c in chars)
    print('已导出: %s' % out)
    print('  角色 %d 个（带图 %d 人 / 共 %d 张）'
          % (len(chars), sum(1 for c in chars if c['images']), img_n))
    print('  世界设定 %d 条' % len(worlds))
    print('  关系 %d 条' % len(rels))
    print('  体积 %.1f KB' % (os.path.getsize(out) / 1024))
    return 0


if __name__ == '__main__':
    sys.exit(main())
