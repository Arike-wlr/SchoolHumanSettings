"""
高校拟人 OC 设定管理 - FastAPI 后端

启动方式：
    python backend.py                    # 使用默认端口 8000
    python backend.py --port 8080        # 使用自定义端口
    python backend.py --port=9000
"""

import argparse
import math
import re
import sqlite3
import os
import json
import hashlib
import shutil
import zipfile
import xml.etree.ElementTree as ET
from datetime import datetime
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, JSONResponse, Response
from pydantic import BaseModel, Field
from typing import Optional, List
import uuid

# 路径配置：基于本文件所在目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "oc_characters.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "文字设定")
DESKTOP_DIR = os.path.join(BASE_DIR, "..", "desktop-offline")
MOBILE_DIR = os.path.join(BASE_DIR, "..", "android-app", "app", "src", "main", "assets", "web")
IMAGE_DIR = os.path.join(BASE_DIR, "images")

# 确保上传目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)


def init_db():
    """初始化数据库，创建角色表与世界设定表"""
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.execute("PRAGMA journal_mode=WAL")
    cursor = conn.cursor()

    # 角色表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS characters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL,
            university TEXT DEFAULT '',
            region TEXT DEFAULT '',
            naming_rationale TEXT DEFAULT '',
            height TEXT DEFAULT '',
            gender TEXT DEFAULT '',
            birthday TEXT DEFAULT '',
            appearance TEXT DEFAULT '',
            identity_period TEXT DEFAULT '',
            birth_time TEXT DEFAULT '',
            setting TEXT DEFAULT '',
            image_url TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    # 兼容旧表：如果缺少列则自动添加
    cursor.execute("PRAGMA table_info(characters)")
    cols = [col[1] for col in cursor.fetchall()]
    for col_name in ["university", "region", "naming_rationale", "family", "birthplace", "status", "image_url", "alias"]:
        if col_name not in cols:
            cursor.execute(f"ALTER TABLE characters ADD COLUMN {col_name} TEXT DEFAULT ''")
    if "sort_order" not in cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN sort_order INTEGER DEFAULT 0")
        cursor.execute("UPDATE characters SET sort_order = id")
    # 新增多图字段 images（JSON 数组），并把旧 image_url 迁移为 images 首项
    if "images" not in cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN images TEXT DEFAULT '[]'")
    # 新增人脸框选参数 face_crop（JSON：{img, cx, cy, r}，均为 0~1 比例）
    if "face_crop" not in cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN face_crop TEXT DEFAULT ''")
    cursor.execute("SELECT id, image_url, images FROM characters")
    for row in cursor.fetchall():
        row_id, old_url, images_json = row[0], row[1], row[2]
        existing_images = []
        try:
            existing_images = json.loads(images_json) if images_json else []
        except (json.JSONDecodeError, TypeError):
            existing_images = []
        if not existing_images and old_url:
            existing_images = [old_url]
            cursor.execute("UPDATE characters SET images = ? WHERE id = ?", (json.dumps(existing_images), row_id))

    # 世界设定表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS world_buildings (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            category TEXT DEFAULT '',
            content TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime'))
        )
    """)
    cursor.execute("PRAGMA table_info(world_buildings)")
    wb_cols = [col[1] for col in cursor.fetchall()]
    if "sort_order" not in wb_cols:
        cursor.execute("ALTER TABLE world_buildings ADD COLUMN sort_order INTEGER DEFAULT 0")
        cursor.execute("UPDATE world_buildings SET sort_order = id")
    if "main_category" not in wb_cols:
        cursor.execute("ALTER TABLE world_buildings ADD COLUMN main_category TEXT DEFAULT ''")

    # 关系网表
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS relations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            from_char_id INTEGER NOT NULL,
            to_char_id INTEGER NOT NULL,
            relation_type TEXT DEFAULT '',
            description TEXT DEFAULT '',
            sort_order INTEGER DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now','localtime')),
            updated_at TEXT DEFAULT (datetime('now','localtime')),
            FOREIGN KEY (from_char_id) REFERENCES characters(id) ON DELETE CASCADE,
            FOREIGN KEY (to_char_id) REFERENCES characters(id) ON DELETE CASCADE
        )
    """)
    # 兼容旧表：如果缺少列则自动添加
    cursor.execute("PRAGMA table_info(relations)")
    rel_cols = [col[1] for col in cursor.fetchall()]
    if "sort_order" not in rel_cols:
        cursor.execute("ALTER TABLE relations ADD COLUMN sort_order INTEGER DEFAULT 0")
        cursor.execute("UPDATE relations SET sort_order = id")

    conn.commit()
    conn.close()


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    yield


app = FastAPI(title="高校拟人 OC 设定管理", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 数据模型 ---

class CharacterCreate(BaseModel):
    name: str = Field(..., description="姓名")
    alias: str = Field(default="", description="别名（字、曾用名）")
    university: str = Field(default="", description="代表高校")
    region: str = Field(default="", description="地区/省份")
    naming_rationale: str = Field(default="", description="取名依据")
    height: str = Field(default="", description="身高")
    gender: str = Field(default="", description="性别")
    birthday: str = Field(default="", description="生日")
    appearance: str = Field(default="", description="外貌")
    identity_period: str = Field(default="", description="身份存在时间")
    birth_time: str = Field(default="", description="诞生时间")
    setting: str = Field(default="", description="设定")
    family: str = Field(default="", description="家族")
    birthplace: str = Field(default="", description="诞生地")
    status: str = Field(default="存在", description="存在状态")
    image_url: str = Field(default="", description="角色图片URL（封面，兼容旧字段）")
    images: List[str] = Field(default=[], description="角色图片URL数组（多图）")
    face_crop: str = Field(default="", description="人脸框选参数 JSON：{img,cx,cy,r}（0~1 比例）")


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    alias: Optional[str] = None
    university: Optional[str] = None
    region: Optional[str] = None
    naming_rationale: Optional[str] = None
    height: Optional[str] = None
    gender: Optional[str] = None
    birthday: Optional[str] = None
    appearance: Optional[str] = None
    identity_period: Optional[str] = None
    birth_time: Optional[str] = None
    setting: Optional[str] = None
    family: Optional[str] = None
    birthplace: Optional[str] = None
    status: Optional[str] = None
    image_url: Optional[str] = None
    images: Optional[List[str]] = None
    face_crop: Optional[str] = None


class CharacterResponse(BaseModel):
    id: int
    name: str
    university: str
    alias: str = ""
    region: str
    naming_rationale: str
    height: str
    gender: str
    birthday: str
    appearance: str
    identity_period: str
    birth_time: str
    setting: str
    family: str = ""
    birthplace: str = ""
    status: str = "存在"
    sort_order: int = 0
    face_crop: str = ""
    created_at: str
    updated_at: str


class ReorderItem(BaseModel):
    id: int
    sort_order: int


class ReorderRequest(BaseModel):
    items: List[ReorderItem]


# --- 世界设定模型 ---

class WorldBuildingCreate(BaseModel):
    title: str = Field(..., description="标题")
    category: str = Field(default="", description="分类")
    content: str = Field(default="", description="内容")
    main_category: str = Field(default="", description="大类")


class WorldBuildingUpdate(BaseModel):
    title: Optional[str] = None
    category: Optional[str] = None
    content: Optional[str] = None
    main_category: Optional[str] = None


class WorldBuildingResponse(BaseModel):
    id: int
    title: str
    category: str
    content: str
    main_category: str = ""
    sort_order: int = 0
    created_at: str
    updated_at: str


# --- 关系网模型 ---

class RelationCreate(BaseModel):
    from_char_id: int
    to_char_id: int
    relation_type: str = Field(default="", description="关系类型，如：朋友、CP、师生、冤家等")
    description: str = Field(default="", description="关系描述")


class RelationUpdate(BaseModel):
    from_char_id: Optional[int] = None
    to_char_id: Optional[int] = None
    relation_type: Optional[str] = None
    description: Optional[str] = None


class RelationResponse(BaseModel):
    id: int
    from_char_id: int
    to_char_id: int
    from_name: str = ""
    to_name: str = ""
    relation_type: str
    description: str
    created_at: str
    updated_at: str


class ImageExistRequest(BaseModel):
    """批量图片存在性校验：手机端同步上传前用它一次问完全部图片，
    避免逐张发 GET 把整张图（单张可达十几 MB）拉下来只为看状态码。"""
    urls: List[str] = Field(default_factory=list)


def get_db():
    conn = sqlite3.connect(DB_PATH, timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA busy_timeout=30000")
    return conn


def row_to_dict(row) -> dict:
    return dict(row)


def char_to_dict(row) -> dict:
    """角色行转字典：把 images JSON 字段解析为数组，兼容旧 image_url"""
    d = dict(row)
    images = []
    try:
        images = json.loads(d.get("images") or "[]")
        if not isinstance(images, list):
            images = []
    except (json.JSONDecodeError, TypeError):
        images = []
    # 兼容：如果 images 为空但旧 image_url 有值，回退用 image_url
    if not images and d.get("image_url"):
        images = [d["image_url"]]
    d["images"] = images
    # image_url 保留为第一张图（封面），供卡片快速展示
    d["image_url"] = images[0] if images else ""
    return d


# --- API 路由 ---

@app.get("/api/characters")
def list_characters():
    """获取所有角色"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM characters ORDER BY sort_order ASC, id ASC")
    rows = cursor.fetchall()
    conn.close()
    return [char_to_dict(r) for r in rows]


@app.post("/api/characters/reorder")
def reorder_characters(data: ReorderRequest):
    """批量更新角色排序"""
    conn = get_db()
    cursor = conn.cursor()
    for item in data.items:
        cursor.execute(
            "UPDATE characters SET sort_order = ? WHERE id = ?",
            (item.sort_order, item.id)
        )
    conn.commit()
    conn.close()
    return {"message": "排序已保存"}


@app.get("/api/characters/{char_id}")
def get_character(char_id: int):
    """获取单个角色"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="角色不存在")
    return char_to_dict(row)


@app.post("/api/characters")
def create_character(data: CharacterCreate):
    """创建新角色"""
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    # 新角色排在最前面
    cursor.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM characters")
    next_order = cursor.fetchone()[0]
    cursor.execute(
        """INSERT INTO characters
           (name, alias, university, region, naming_rationale, height, gender, birthday, appearance,
            identity_period, birth_time, setting, family, birthplace, status, image_url, images, face_crop, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.name, data.alias, data.university, data.region, data.naming_rationale,
         data.height, data.gender, data.birthday,
         data.appearance, data.identity_period, data.birth_time,
         data.setting, data.family, data.birthplace, data.status, data.image_url, json.dumps(data.images),
         data.face_crop, next_order, now, now)
    )
    conn.commit()
    char_id = cursor.lastrowid
    cursor.execute("SELECT * FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    conn.close()
    return char_to_dict(row)


@app.put("/api/characters/{char_id}")
def update_character(char_id: int, data: CharacterUpdate):
    """更新角色"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM characters WHERE id = ?", (char_id,))
    existing = cursor.fetchone()
    if not existing:
        conn.close()
        raise HTTPException(status_code=404, detail="角色不存在")

    # 旧 images 列表（用于清理被移除的图片）
    old_images = []
    try:
        old_images = json.loads(existing["images"]) if existing["images"] else []
        if not isinstance(old_images, list):
            old_images = []
    except (json.JSONDecodeError, TypeError):
        old_images = []
    if not old_images and existing["image_url"]:
        old_images = [existing["image_url"]]

    updates = {}
    for field in ["name", "alias", "university", "region", "naming_rationale", "height", "gender", "birthday", "appearance",
                  "identity_period", "birth_time", "setting", "family", "birthplace", "status", "image_url", "face_crop"]:
        val = getattr(data, field)
        if val is not None:
            updates[field] = val
    # images 数组单独处理（需序列化为 JSON）
    if data.images is not None:
        updates["images"] = json.dumps(data.images)
        # 同步封面字段 image_url 为第一张图
        updates["image_url"] = data.images[0] if data.images else ""

    if updates:
        updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [char_id]
        cursor.execute(
            f"UPDATE characters SET {set_clause} WHERE id = ?", values
        )
        conn.commit()
        # 清理被移除的旧图片文件（旧列表中存在但新列表中不存在的 URL）
        if data.images is not None:
            removed = [u for u in old_images if u not in data.images]
            _delete_unused_images(cursor, removed)

    cursor.execute("SELECT * FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    conn.close()
    return char_to_dict(row)


@app.delete("/api/characters/{char_id}")
def delete_character(char_id: int):
    """删除角色"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="角色不存在")
    # 收集该角色所有图片 URL（images 数组 + 兼容旧 image_url）
    old_images = []
    try:
        old_images = json.loads(row["images"]) if row["images"] else []
        if not isinstance(old_images, list):
            old_images = []
    except (json.JSONDecodeError, TypeError):
        old_images = []
    if row["image_url"] and row["image_url"] not in old_images:
        old_images.append(row["image_url"])
    cursor.execute("DELETE FROM characters WHERE id = ?", (char_id,))
    conn.commit()
    # 删除角色后，清理其图片文件（如果没有其他角色引用）
    _delete_unused_images(cursor, old_images)
    conn.close()
    return {"message": "删除成功"}


@app.get("/api/world-buildings")
def list_world_buildings(main_category: str = ""):
    """获取所有世界设定，可选按大类筛选"""
    conn = get_db()
    cursor = conn.cursor()
    if main_category:
        cursor.execute("SELECT * FROM world_buildings WHERE main_category = ? ORDER BY sort_order ASC, id ASC", (main_category,))
    else:
        cursor.execute("SELECT * FROM world_buildings ORDER BY sort_order ASC, id ASC")
    rows = cursor.fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


@app.post("/api/world-buildings/reorder")
def reorder_world_buildings(data: ReorderRequest):
    """批量更新世界设定排序"""
    conn = get_db()
    cursor = conn.cursor()
    for item in data.items:
        cursor.execute(
            "UPDATE world_buildings SET sort_order = ? WHERE id = ?",
            (item.sort_order, item.id)
        )
    conn.commit()
    conn.close()
    return {"message": "排序已保存"}


@app.get("/api/world-buildings/{wb_id}")
def get_world_building(wb_id: int):
    """获取单个世界设定"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM world_buildings WHERE id = ?", (wb_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="世界设定不存在")
    return row_to_dict(row)


@app.post("/api/world-buildings")
def create_world_building(data: WorldBuildingCreate):
    """创建世界设定"""
    conn = get_db()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM world_buildings")
    next_order = cursor.fetchone()[0]
    cursor.execute(
        """INSERT INTO world_buildings
           (title, category, content, main_category, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (data.title, data.category, data.content, data.main_category, next_order, now, now)
    )
    conn.commit()
    wb_id = cursor.lastrowid
    cursor.execute("SELECT * FROM world_buildings WHERE id = ?", (wb_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row)


@app.put("/api/world-buildings/{wb_id}")
def update_world_building(wb_id: int, data: WorldBuildingUpdate):
    """更新世界设定"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM world_buildings WHERE id = ?", (wb_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="世界设定不存在")

    updates = {}
    for field in ["title", "category", "content", "main_category"]:
        val = getattr(data, field)
        if val is not None:
            updates[field] = val

    if updates:
        updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [wb_id]
        cursor.execute(
            f"UPDATE world_buildings SET {set_clause} WHERE id = ?", values
        )
        conn.commit()

    cursor.execute("SELECT * FROM world_buildings WHERE id = ?", (wb_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row)


@app.delete("/api/world-buildings/{wb_id}")
def delete_world_building(wb_id: int):
    """删除世界设定"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM world_buildings WHERE id = ?", (wb_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="世界设定不存在")
    cursor.execute("DELETE FROM world_buildings WHERE id = ?", (wb_id,))
    conn.commit()
    conn.close()
    return {"message": "删除成功"}


# --- 关系网 API ---

@app.get("/api/relations")
def list_relations():
    """获取所有关系"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.*, 
               c1.name as from_name, 
               c2.name as to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        ORDER BY r.sort_order ASC, r.id ASC
    """)
    rows = cursor.fetchall()
    conn.close()
    return [row_to_dict(r) for r in rows]


@app.post("/api/relations")
def create_relation(data: RelationCreate):
    """创建关系"""
    if data.from_char_id == data.to_char_id:
        raise HTTPException(status_code=400, detail="不能与自己建立关系")
    conn = get_db()
    cursor = conn.cursor()
    # 验证角色存在
    cursor.execute("SELECT id FROM characters WHERE id = ?", (data.from_char_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="来源角色不存在")
    cursor.execute("SELECT id FROM characters WHERE id = ?", (data.to_char_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="目标角色不存在")
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute("SELECT COALESCE(MAX(sort_order), 0) + 1 FROM relations")
    next_order = cursor.fetchone()[0]
    cursor.execute(
        """INSERT INTO relations (from_char_id, to_char_id, relation_type, description, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (data.from_char_id, data.to_char_id, data.relation_type, data.description, next_order, now, now)
    )
    conn.commit()
    rel_id = cursor.lastrowid
    cursor.execute("""
        SELECT r.*, c1.name as from_name, c2.name as to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        WHERE r.id = ?
    """, (rel_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row)


@app.get("/api/relations/{rel_id}")
def get_relation(rel_id: int):
    """获取单个关系"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("""
        SELECT r.*, c1.name as from_name, c2.name as to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        WHERE r.id = ?
    """, (rel_id,))
    row = cursor.fetchone()
    conn.close()
    if not row:
        raise HTTPException(status_code=404, detail="关系不存在")
    return row_to_dict(row)


@app.post("/api/relations/reorder")
def reorder_relations(data: ReorderRequest):
    """批量更新关系排序"""
    conn = get_db()
    cursor = conn.cursor()
    for item in data.items:
        cursor.execute(
            "UPDATE relations SET sort_order = ? WHERE id = ?",
            (item.sort_order, item.id)
        )
    conn.commit()
    conn.close()
    return {"message": "排序已保存"}


@app.put("/api/relations/{rel_id}")
def update_relation(rel_id: int, data: RelationUpdate):
    """更新关系"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM relations WHERE id = ?", (rel_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="关系不存在")
    updates = {}
    for field in ["from_char_id", "to_char_id", "relation_type", "description"]:
        val = getattr(data, field)
        if val is not None:
            updates[field] = val
    # 验证角色存在
    if "from_char_id" in updates:
        cursor.execute("SELECT id FROM characters WHERE id = ?", (updates["from_char_id"],))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="来源角色不存在")
    if "to_char_id" in updates:
        cursor.execute("SELECT id FROM characters WHERE id = ?", (updates["to_char_id"],))
        if not cursor.fetchone():
            conn.close()
            raise HTTPException(status_code=404, detail="目标角色不存在")
    if "from_char_id" in updates and "to_char_id" in updates and updates["from_char_id"] == updates["to_char_id"]:
        conn.close()
        raise HTTPException(status_code=400, detail="不能与自己建立关系")
    if updates:
        updates["updated_at"] = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        set_clause = ", ".join(f"{k} = ?" for k in updates)
        values = list(updates.values()) + [rel_id]
        cursor.execute(f"UPDATE relations SET {set_clause} WHERE id = ?", values)
        conn.commit()
    cursor.execute("""
        SELECT r.*, c1.name as from_name, c2.name as to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        WHERE r.id = ?
    """, (rel_id,))
    row = cursor.fetchone()
    conn.close()
    return row_to_dict(row)


@app.delete("/api/relations/{rel_id}")
def delete_relation(rel_id: int):
    """删除关系"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM relations WHERE id = ?", (rel_id,))
    if not cursor.fetchone():
        conn.close()
        raise HTTPException(status_code=404, detail="关系不存在")
    cursor.execute("DELETE FROM relations WHERE id = ?", (rel_id,))
    conn.commit()
    conn.close()
    return {"message": "删除成功"}


# --- 文档管理 API ---

ALLOWED_EXTENSIONS = {".docx", ".doc", ".pdf", ".txt", ".md"}
ALLOWED_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".bmp", ".webp", ".svg"}


@app.get("/api/files")
def list_files():
    """列出所有已上传的文档"""
    if not os.path.exists(UPLOAD_DIR):
        return []
    files = []
    for fname in os.listdir(UPLOAD_DIR):
        fpath = os.path.join(UPLOAD_DIR, fname)
        if os.path.isfile(fpath):
            stat = os.stat(fpath)
            files.append({
                "name": fname,
                "size": stat.st_size,
                "size_display": format_size(stat.st_size),
                "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M:%S"),
            })
    files.sort(key=lambda f: f["name"])
    return files


def format_size(size: int) -> str:
    for unit in ["B", "KB", "MB", "GB"]:
        if size < 1024:
            return f"{size:.1f} {unit}" if unit != "B" else f"{size} B"
        size /= 1024
    return f"{size:.1f} TB"


@app.post("/api/files/upload")
async def upload_files(files: List[UploadFile] = File(...)):
    """上传文档（支持多文件）"""
    uploaded = []
    for file in files:
        if not file.filename:
            continue
        ext = os.path.splitext(file.filename)[1].lower()
        if ext not in ALLOWED_EXTENSIONS:
            raise HTTPException(
                status_code=400,
                detail=f"不支持的文件类型: {ext}，仅支持 {', '.join(ALLOWED_EXTENSIONS)}"
            )
        # 安全文件名
        safe_name = os.path.basename(file.filename)
        fpath = os.path.join(UPLOAD_DIR, safe_name)
        with open(fpath, "wb") as f:
            content = await file.read()
            f.write(content)
        uploaded.append(safe_name)
    return {"message": f"已上传 {len(uploaded)} 个文件", "files": uploaded}


async def _save_image_file(file: UploadFile) -> tuple[str, str]:
    """校验并保存上传的图片，返回 (image_url, filename)。
    按文件内容 SHA-256 命名，内容相同的图片自动去重，不重复存储。"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名为空")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片类型: {ext}，仅支持 {', '.join(ALLOWED_IMAGE_EXTENSIONS)}"
        )
    content = await file.read()
    content_hash = hashlib.sha256(content).hexdigest()
    unique_filename = f"{content_hash}{ext}"
    image_path = os.path.join(IMAGE_DIR, unique_filename)
    if not os.path.exists(image_path):
        try:
            with open(image_path, "wb") as f:
                f.write(content)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"图片保存失败: {str(e)}")
    else:
        print(f"[images/upload] 内容去重命中，跳过写入: {unique_filename}")
    return f"/api/images/{unique_filename}", unique_filename


def _delete_image_file_if_unused(cursor, image_url: str):
    """删除图片文件（如果没有其他角色引用）"""
    if not image_url:
        return
    # 检查所有角色的 images 数组（兼容旧 image_url 字段）是否引用该 URL
    cursor.execute("SELECT image_url, images FROM characters")
    for row in cursor.fetchall():
        urls = []
        try:
            urls = json.loads(row["images"]) if row["images"] else []
            if not isinstance(urls, list):
                urls = []
        except (json.JSONDecodeError, TypeError):
            urls = []
        if not urls and row["image_url"]:
            urls = [row["image_url"]]
        if image_url in urls:
            return  # 仍被引用，不删
    filename = os.path.basename(image_url)
    image_path = os.path.join(IMAGE_DIR, filename)
    if os.path.exists(image_path) and os.path.isfile(image_path):
        try:
            os.remove(image_path)
        except OSError:
            pass


def _delete_unused_images(cursor, image_urls: list):
    """批量删除不再被引用的图片文件"""
    for url in image_urls:
        _delete_image_file_if_unused(cursor, url)


@app.post("/api/images/upload")
async def upload_image(file: UploadFile = File(...)):
    """通用图片上传（无需角色ID），返回 image_url，由后续创建/更新角色时保存"""
    print(f"[images/upload] 收到图片: {file.filename}, 大小: {file.size} bytes")
    image_url, filename = await _save_image_file(file)
    return {"message": "图片上传成功", "image_url": image_url, "filename": filename}


@app.post("/api/characters/{char_id}/upload-image")
async def upload_character_image(char_id: int, file: UploadFile = File(...)):
    """上传角色图片并追加到该角色的图片列表（多图）"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT image_url, images FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="角色不存在")

    image_url, unique_filename = await _save_image_file(file)

    # 读取现有 images 数组并追加新图
    images = []
    try:
        images = json.loads(row["images"]) if row["images"] else []
        if not isinstance(images, list):
            images = []
    except (json.JSONDecodeError, TypeError):
        images = []
    images.append(image_url)

    cursor.execute(
        "UPDATE characters SET image_url = ?, images = ?, updated_at = ? WHERE id = ?",
        (images[0] if images else "", json.dumps(images), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), char_id)
    )
    conn.commit()
    conn.close()

    return {"message": "图片上传成功", "image_url": image_url, "images": images, "filename": unique_filename}


@app.delete("/api/characters/{char_id}/images/{index}")
def delete_character_image(char_id: int, index: int):
    """删除角色的指定图片（按索引），并清理文件"""
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT image_url, images FROM characters WHERE id = ?", (char_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        raise HTTPException(status_code=404, detail="角色不存在")

    images = []
    try:
        images = json.loads(row["images"]) if row["images"] else []
        if not isinstance(images, list):
            images = []
    except (json.JSONDecodeError, TypeError):
        images = []
    if not images and row["image_url"]:
        images = [row["image_url"]]

    if index < 0 or index >= len(images):
        conn.close()
        raise HTTPException(status_code=400, detail="图片索引超出范围")

    removed_url = images.pop(index)
    cursor.execute(
        "UPDATE characters SET image_url = ?, images = ?, updated_at = ? WHERE id = ?",
        (images[0] if images else "", json.dumps(images), datetime.now().strftime("%Y-%m-%d %H:%M:%S"), char_id)
    )
    conn.commit()
    # 清理被删除的图片文件（如果无其他角色引用）
    _delete_image_file_if_unused(cursor, removed_url)
    conn.close()

    return {"message": "图片删除成功", "images": images}


@app.get("/api/images/{filename}")
def serve_image(filename: str):
    """提供上传的图片"""
    safe_name = os.path.basename(filename)
    image_path = os.path.join(IMAGE_DIR, safe_name)
    if not os.path.exists(image_path) or not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(image_path)


def _image_path_from_ref(ref: str) -> Optional[str]:
    """把客户端传来的图片引用（/api/images/x.png 或完整 URL）解析成本地绝对路径。
    解析不出来或越界返回 None。"""
    raw = (ref or "").split("?", 1)[0].split("#", 1)[0]
    name = os.path.basename(raw)
    if not name or name in (".", ".."):
        return None
    return os.path.join(IMAGE_DIR, name)


@app.head("/api/images/{filename}")
def head_image(filename: str):
    """只回状态码与长度，不传正文。
    同步时的「这张图还在不在」只需要这一条信息，不该把整张图拉下来。"""
    image_path = _image_path_from_ref(filename)
    if not image_path or not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="图片不存在")
    return Response(
        status_code=200,
        headers={"Content-Length": str(os.path.getsize(image_path))},
    )


@app.post("/api/images/exists")
def images_exist(data: ImageExistRequest):
    """批量检查图片是否仍存在。

    手机端上传前需要确认"本地图片在服务器上是否还有对应文件"，原本是逐张发
    GET 再丢弃正文 —— 43 张图（合计约 137 MB）就这么白跑一遍。改成一次请求
    批量问，返回 missing / existing 两类，客户端按缓存里的候选地址比对即可。

    传入的引用原样回传（不规范化），这样客户端能直接拿来与自己的缓存键比对。
    """
    missing, existing = [], []
    for ref in data.urls:
        image_path = _image_path_from_ref(ref)
        if image_path and os.path.isfile(image_path):
            existing.append(ref)
        else:
            missing.append(ref)
    return {
        "total": len(data.urls),
        "existing": existing,
        "missing": missing,
    }


@app.delete("/api/images/{filename}")
def delete_image(filename: str):
    """删除图片"""
    safe_name = os.path.basename(filename)
    image_path = os.path.join(IMAGE_DIR, safe_name)
    if not os.path.exists(image_path) or not os.path.isfile(image_path):
        raise HTTPException(status_code=404, detail="图片不存在")
    
    # 检查是否有角色在使用此图片（检查 images 数组和旧 image_url 字段）
    target_url = f"/api/images/{safe_name}"
    conn = get_db()
    cursor = conn.cursor()
    cursor.execute("SELECT id, name, image_url, images FROM characters")
    using_characters = []
    for r in cursor.fetchall():
        urls = []
        try:
            urls = json.loads(r["images"]) if r["images"] else []
            if not isinstance(urls, list):
                urls = []
        except (json.JSONDecodeError, TypeError):
            urls = []
        if not urls and r["image_url"]:
            urls = [r["image_url"]]
        if target_url in urls:
            using_characters.append(r)

    if using_characters:
        conn.close()
        raise HTTPException(
            status_code=400, 
            detail=f"图片正在被以下角色使用，无法删除: {', '.join([c['name'] for c in using_characters])}"
        )
    
    os.remove(image_path)
    conn.close()
    return {"message": f"已删除图片 {safe_name}"}


def parse_docx_with_images(fpath, cache_dir, fname):
    """解析 docx，提取文字和图片，返回 (content_array, cache_key)"""
    NSMAP = {
        'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main',
        'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
        'r': 'http://schemas.openxmlformats.org/officeDocument/2006/relationships',
    }

    content = []
    fname_hash = hashlib.md5(f"{fname}_{os.path.getmtime(fpath)}".encode()).hexdigest()[:12]
    img_cache_dir = os.path.join(cache_dir, fname_hash)
    os.makedirs(img_cache_dir, exist_ok=True)

    with zipfile.ZipFile(fpath, 'r') as z:
        # 解析 relationships，建立 rId → image 映射
        rid_to_image = {}
        try:
            rels_xml = z.read('word/_rels/document.xml.rels')
            rels_root = ET.fromstring(rels_xml)
            for rel in rels_root:
                rtype = rel.get('Type', '')
                rid = rel.get('Id', '')
                target = rel.get('Target', '')
                if 'image' in rtype.lower():
                    rid_to_image[rid] = os.path.basename(target)
        except Exception:
            pass

        # 提取所有图片到缓存
        for entry in z.namelist():
            if entry.startswith('word/media/') and not entry.endswith('/'):
                img_name = os.path.basename(entry)
                target_path = os.path.join(img_cache_dir, img_name)
                if not os.path.exists(target_path):
                    with z.open(entry) as src, open(target_path, 'wb') as dst:
                        dst.write(src.read())

        # 解析 document.xml
        doc_xml = z.read('word/document.xml')
        root = ET.fromstring(doc_xml)
        body = root.find(f'{{{NSMAP["w"]}}}body')
        if body is None:
            return content, fname_hash

        for elem in body:
            if elem.tag != f'{{{NSMAP["w"]}}}p':
                continue

            # 提取文字
            texts = []
            for t_elem in elem.findall(f'.//{{{NSMAP["w"]}}}t'):
                if t_elem.text:
                    texts.append(t_elem.text)
            text = ''.join(texts)

            # 检测段落样式是否为标题
            pPr = elem.find(f'{{{NSMAP["w"]}}}pPr')
            is_heading = False
            if pPr is not None:
                pStyle = pPr.find(f'{{{NSMAP["w"]}}}pStyle')
                if pStyle is not None:
                    style_val = pStyle.get(f'{{{NSMAP["w"]}}}val', '')
                    is_heading = 'Heading' in style_val or 'heading' in style_val.lower()

            # 检测段落内的图片
            drawings = elem.findall(f'.//{{{NSMAP["w"]}}}drawing')
            for drawing in drawings:
                blip = drawing.find(f'.//{{{NSMAP["a"]}}}blip')
                if blip is not None:
                    embed = blip.get(f'{{{NSMAP["r"]}}}embed', '')
                    img_filename = rid_to_image.get(embed, '')
                    if img_filename:
                        content.append({
                            "type": "image",
                            "src": img_filename,
                            "caption": text.strip() if text.strip() else None
                        })

            # 添加文字段落
            if text.strip() or not drawings:
                content.append({
                    "type": "text",
                    "text": text,
                    "is_heading": is_heading
                })

        return content, fname_hash


@app.get("/api/files/images/{cache_key}/{img_name}")
def serve_docx_image(cache_key: str, img_name: str):
    """提供 docx 中提取的图片"""
    cache_key = os.path.basename(cache_key)
    img_name = os.path.basename(img_name)
    img_cache_dir = os.path.join(UPLOAD_DIR, ".images_cache")
    img_path = os.path.join(img_cache_dir, cache_key, img_name)
    if not os.path.exists(img_path) or not os.path.isfile(img_path):
        raise HTTPException(status_code=404, detail="图片不存在")
    return FileResponse(img_path)


@app.get("/api/files/{fname:path}/view")
def view_file_content(fname: str):
    """在线查看文档内容（支持 docx/txt/md）"""
    safe_name = os.path.basename(fname)
    fpath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(fpath) or not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="文件不存在")

    ext = os.path.splitext(safe_name)[1].lower()
    content = ""
    file_type = ""
    cache_key = None

    if ext in (".txt", ".md"):
        file_type = "markdown" if ext == ".md" else "text"
        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
            content = f.read()
    elif ext == ".docx":
        file_type = "docx"
        try:
            image_cache_dir = os.path.join(UPLOAD_DIR, ".images_cache")
            content, cache_key = parse_docx_with_images(fpath, image_cache_dir, safe_name)
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"文档解析失败: {str(e)}")
    else:
        raise HTTPException(status_code=400, detail=f"不支持在线查看的文件类型: {ext}")

    return JSONResponse({
        "name": safe_name,
        "type": file_type,
        "content": content,
        "cache_key": cache_key
    })


@app.get("/api/files/{fname:path}")
def download_file(fname: str):
    """下载/查看文档"""
    # 安全检查：防止路径穿越
    safe_name = os.path.basename(fname)
    fpath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(fpath) or not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="文件不存在")
    return FileResponse(fpath, filename=safe_name)


@app.delete("/api/files/{fname:path}")
def delete_file(fname: str):
    """删除文档"""
    safe_name = os.path.basename(fname)
    fpath = os.path.join(UPLOAD_DIR, safe_name)
    if not os.path.exists(fpath) or not os.path.isfile(fpath):
        raise HTTPException(status_code=404, detail="文件不存在")
    os.remove(fpath)
    return {"message": f"已删除 {safe_name}"}


# ============================================================
# 全局搜索 API
# ============================================================

SEARCH_SNIPPET_BEFORE = 18   # 匹配点前保留的字符数
SEARCH_SNIPPET_AFTER = 30    # 匹配点后保留的字符数
SEARCH_MAX_PER_GROUP = 20    # 每组最多返回条数


def _make_snippet(text: str, q_lower: str, q_len: int) -> str:
    """生成匹配片段：匹配点前后各留若干字符，首尾加省略号"""
    if not text:
        return ""
    flat = " ".join(str(text).split())  # 压平换行/连续空白
    pos = flat.lower().find(q_lower)
    if pos < 0:
        flat = flat[:SEARCH_SNIPPET_BEFORE + SEARCH_SNIPPET_AFTER]
        return flat + ("…" if len(flat) >= SEARCH_SNIPPET_BEFORE + SEARCH_SNIPPET_AFTER else "")
    start = max(0, pos - SEARCH_SNIPPET_BEFORE)
    end = min(len(flat), pos + q_len + SEARCH_SNIPPET_AFTER)
    return ("…" if start > 0 else "") + flat[start:end] + ("…" if end < len(flat) else "")


@app.get("/api/search")
def global_search(q: str = ""):
    """全局搜索：角色 / 世界设定 / 关系 / 文档（含 txt、md 正文）"""
    q = (q or "").strip()
    empty = {"characters": [], "worldview": [], "relations": [], "documents": []}
    if not q:
        return empty
    like = f"%{q}%"
    q_lower = q.lower()
    conn = get_db()
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    # ---- 角色 ----
    characters = []
    try:
        cursor.execute(
            """SELECT * FROM characters
               WHERE name LIKE ? OR university LIKE ? OR region LIKE ? OR naming_rationale LIKE ?
                  OR appearance LIKE ? OR setting LIKE ? OR birthplace LIKE ? OR family LIKE ?
                  OR birthday LIKE ? OR gender LIKE ? OR status LIKE ?
               ORDER BY sort_order ASC, id ASC""",
            (like, like, like, like, like, like, like, like, like, like, like),
        )
        for row in cursor.fetchall()[:SEARCH_MAX_PER_GROUP]:
            c = char_to_dict(row)
            # 找出命中的字段，生成片段
            snippet = ""
            matched_field = ""
            for field in ["name", "university", "region", "naming_rationale", "appearance",
                          "setting", "birthplace", "family", "birthday", "gender", "status"]:
                val = str(c.get(field) or "")
                if q_lower in val.lower():
                    matched_field = field
                    if not snippet:
                        snippet = _make_snippet(val, q_lower, len(q))
                        if field != "name":
                            break
            characters.append({
                "id": c["id"], "name": c["name"], "university": c["university"],
                "region": c["region"], "gender": c.get("gender", ""),
                "image_url": c.get("image_url", ""),
                "matched_field": matched_field, "snippet": snippet,
            })
    except Exception as e:
        print(f"[search] characters error: {e}")

    # ---- 世界设定 ----
    worldview = []
    try:
        cursor.execute(
            """SELECT * FROM world_buildings
               WHERE title LIKE ? OR category LIKE ? OR main_category LIKE ? OR content LIKE ?
               ORDER BY sort_order ASC, id ASC""",
            (like, like, like, like),
        )
        for row in cursor.fetchall()[:SEARCH_MAX_PER_GROUP]:
            w = dict(row)
            snippet = _make_snippet(w.get("content") or "", q_lower, len(q))
            if not snippet:
                snippet = _make_snippet(w.get("category") or "", q_lower, len(q))
            worldview.append({
                "id": w["id"], "title": w["title"], "category": w.get("category", ""),
                "main_category": w.get("main_category", ""), "snippet": snippet,
            })
    except Exception as e:
        print(f"[search] worldview error: {e}")

    # ---- 关系 ----
    relations = []
    try:
        cursor.execute(
            """SELECT r.*, c1.name AS from_name, c2.name AS to_name
               FROM relations r
               LEFT JOIN characters c1 ON r.from_char_id = c1.id
               LEFT JOIN characters c2 ON r.to_char_id = c2.id
               WHERE r.relation_type LIKE ? OR r.description LIKE ?
                  OR c1.name LIKE ? OR c2.name LIKE ?
               ORDER BY r.sort_order ASC, r.id ASC""",
            (like, like, like, like),
        )
        for row in cursor.fetchall()[:SEARCH_MAX_PER_GROUP]:
            r = dict(row)
            snippet = _make_snippet(r.get("description") or "", q_lower, len(q))
            relations.append({
                "id": r["id"], "from_name": r.get("from_name") or "", "to_name": r.get("to_name") or "",
                "relation_type": r.get("relation_type") or "", "snippet": snippet,
            })
    except Exception as e:
        print(f"[search] relations error: {e}")

    # ---- 文档（文件名 + txt/md 正文）----
    documents = []
    try:
        if os.path.exists(UPLOAD_DIR):
            for fname in os.listdir(UPLOAD_DIR):
                fpath = os.path.join(UPLOAD_DIR, fname)
                if not os.path.isfile(fpath):
                    continue
                ext = os.path.splitext(fname)[1].lower()
                snippet = ""
                # txt/md 搜正文（限制 2MB 以内，避免大文件拖慢）
                if ext in (".txt", ".md") and os.path.getsize(fpath) < 2 * 1024 * 1024:
                    try:
                        with open(fpath, "r", encoding="utf-8", errors="replace") as f:
                            content = f.read()
                        if q_lower in content.lower():
                            snippet = _make_snippet(content, q_lower, len(q))
                    except Exception:
                        pass
                if q_lower in fname.lower() or snippet:
                    stat = os.stat(fpath)
                    documents.append({
                        "name": fname,
                        "size_display": format_size(stat.st_size),
                        "modified": datetime.fromtimestamp(stat.st_mtime).strftime("%Y-%m-%d %H:%M"),
                        "snippet": snippet,
                    })
                if len(documents) >= SEARCH_MAX_PER_GROUP:
                    break
    except Exception as e:
        print(f"[search] documents error: {e}")

    conn.close()
    return {"characters": characters, "worldview": worldview, "relations": relations, "documents": documents}


# ============================================================
# 总览统计 API
# ============================================================
#
# 口径说明（手机版必须保持一致，改这里要同步改 android-app 的 api-shim.js computeStats）：
#   - 空字段（空串 / 只有空白）一律归入「未填写」。
#   - 性别正常化为 男 / 女 / 其他 / 未填写；写了别的文字归「其他」。
#   - 存在状态除空值归「存在」外，其余按原值分桶（"已消逝" / "普通人" 等）。
#   - 家族从 characters.family 字段分号/逗号/顿号/斜杠分隔聚合。
#   - 关系度 = 该角色作为 from 或 to 出现的关系条数（无向计次，自环算 1）。
#   - 字数一律按 **Unicode 码点** 计数（Python 的 len 天然如此；JS 端必须用
#     Array.from(str).length，用 str.length 会把 emoji 算成 2 个而对不上）。
#   - **绝不解析 birth_time / birthday**，它们是自由文本。

STATS_TOP_N = 12          # 各分布榜最多返回多少项
STATS_RANK_N = 10         # 排行榜最多返回多少条
STATS_WORLD_RANK_N = 10   # 「最长的世界观条目」榜单条数
STATS_MAX_CROSS = 400     # 交叉矩阵最多返回多少行
STATS_MIN_REGION = 3      # 地区凝聚力/设定厚度：该地区至少多少人/多少条关系才上榜

# 完整度体检：检查的字段与中文名（顺序即展示顺序）
STATS_COMPLETENESS_FIELDS = [
    ("university", "代表高校"),
    ("region", "地区"),
    ("naming_rationale", "取名依据"),
    ("gender", "性别"),
    ("birthday", "生日"),
    ("height", "身高"),
    ("appearance", "外貌"),
    ("identity_period", "身份时间"),
    ("birth_time", "诞生时间"),
    ("birthplace", "诞生地"),
    ("setting", "设定描述"),
    ("family", "家族"),
    ("alias", "别名"),
    ("images", "图片"),
    ("face_crop", "人脸头像"),
]


def _norm_bucket(value: str, empty_label: str = "未填写") -> str:
    """把自由文本字段归桶：空串/纯空白 → empty_label"""
    v = (value or "").strip()
    return v if v else empty_label


def _norm_gender(value: str) -> str:
    v = (value or "").strip()
    if not v:
        return "未填写"
    if v in ("男", "男性", "M", "m", "male", "Male"):
        return "男"
    if v in ("女", "女性", "F", "f", "female", "Female"):
        return "女"
    return "其他"


def _split_multi(value: str) -> list:
    """把「家族」这类可能写了多个值的字段拆开。
    分隔符：; ； , ， 、 / | 以及换行。字段本身若写成 "张氏 李氏" 不拆（空格不算分隔符）。"""
    if not value:
        return []
    raw = re.split(r"[;；,，、/|\\\r\n]+", str(value))
    out = []
    for item in raw:
        s = item.strip()
        if s:
            out.append(s)
    return out


def _dist_pairs(counter: dict, top_n: int = 0) -> list:
    """把计数字典转成 [{name, count}]，按 count 降序，count 相同按名称升序。
    top_n > 0 时只取前 top_n 项。"""
    items = sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))
    if top_n > 0:
        items = items[:top_n]
    return [{"name": k, "count": v} for k, v in items]


def _round0(value) -> int:
    """取整，**远离零** 舍入。同样不能用内置 round()（银行家舍入会让 552.5→552，
    而 JS 的 Math.round 给 553）。与前端 statsRound0() 对应。"""
    v = float(value or 0)
    return int(math.floor(v + 0.5) if v >= 0 else math.ceil(v - 0.5))


def _round1(value) -> float:
    """保留 1 位小数，**远离零** 舍入。
    不能用内置 round()：它是银行家舍入（四舍六入五成双），恰好落在 .x5 的值会与
    JS 的 Math.round 差 1 个末位（实测 cohesion 31.25 → Py round 31.2 / JS 31.3）。
    手机版 api-shim.js 的 statsRound1() 做同样处理，两边必须一致。
    实现与 JS 的 (v<0 ? -Math.round(-v*10) : Math.round(v*10))/10 完全对应。"""
    v = float(value or 0) * 10
    scaled = math.floor(v + 0.5) if v >= 0 else math.ceil(v - 0.5)
    return scaled / 10


def _char_text_len(value) -> int:
    """字符体量：按码点计数（与 JS 的 Array.from(str).length 对齐）"""
    return len(str(value or ""))


@app.get("/api/stats")
def get_stats():
    """总览统计：角色 / 世界设定 / 关系 三类数据的聚合视图"""
    conn = get_db()
    cursor = conn.cursor()

    # ---------- 角色 ----------
    cursor.execute("SELECT * FROM characters ORDER BY sort_order ASC, id ASC")
    chars = [char_to_dict(r) for r in cursor.fetchall()]

    region_counter = {}
    gender_counter = {}
    status_counter = {}
    family_counter = {}
    university_counter = {}
    image_count_total = 0
    face_crop_count = 0
    no_image_count = 0

    for c in chars:
        region_counter[_norm_bucket(c.get("region"))] = region_counter.get(_norm_bucket(c.get("region")), 0) + 1
        g = _norm_gender(c.get("gender"))
        gender_counter[g] = gender_counter.get(g, 0) + 1
        # status 默认值是 "存在"，老数据可能是空串
        st = (c.get("status") or "").strip() or "存在"
        status_counter[st] = status_counter.get(st, 0) + 1
        uni = (c.get("university") or "").strip()
        if uni:
            university_counter[uni] = university_counter.get(uni, 0) + 1
        for fam in _split_multi(c.get("family")):
            family_counter[fam] = family_counter.get(fam, 0) + 1

        imgs = c.get("images") or []
        if imgs:
            image_count_total += len(imgs)
        else:
            no_image_count += 1
        if (c.get("face_crop") or "").strip():
            face_crop_count += 1

    characters_block = {
        "total": len(chars),
        "with_image": len(chars) - no_image_count,
        "no_image": no_image_count,
        "image_total": image_count_total,
        "with_face_crop": face_crop_count,
        "region": _dist_pairs(region_counter, STATS_TOP_N),
        "gender": _dist_pairs(gender_counter),
        "status": _dist_pairs(status_counter),
        "family": _dist_pairs(family_counter, STATS_TOP_N),
        "university": _dist_pairs(university_counter, STATS_TOP_N),
    }

    # ---------- 亮点：每个地区的关系个数（用于地区凝聚力 / 设定厚度）----------
    region_total_rel = {}      # 地区 -> 该地区角色涉及的关系数（两端计次）
    region_inside_rel = {}     # 地区 -> 其中两端都在该地区的关系数
    region_setting_sum = {}    # 地区 -> setting 字数合计
    region_char_count = {}     # 地区 -> 角色数
    for c in chars:
        r = _norm_bucket(c.get("region"))
        region_setting_sum[r] = region_setting_sum.get(r, 0) + _char_text_len(c.get("setting"))
        region_char_count[r] = region_char_count.get(r, 0) + 1

    # ---------- 世界设定 ----------
    cursor.execute("SELECT * FROM world_buildings ORDER BY sort_order ASC, id ASC")
    worlds = [dict(r) for r in cursor.fetchall()]

    main_counter = {}
    content_chars = 0
    longest_entry = None        # (字数, 标题) —— 兼容旧字段，保留最长一条
    # [(字数, 标题, id)]：带 id 才能让统计页榜单直达世界观详情页（worldview.html?wb=ID）
    # 排序键保持 (-字数, 标题)，id 只作载荷不参与排序，避免两端顺序分叉
    world_rank = []
    for w in worlds:
        mc = _norm_bucket(w.get("main_category"), "未分类")
        main_counter[mc] = main_counter.get(mc, 0) + 1
        n = _char_text_len(w.get("content"))
        content_chars += n
        title = w.get("title") or ""
        world_rank.append((n, title, w.get("id")))
        if longest_entry is None or n > longest_entry[0]:
            longest_entry = (n, title)

    # 按字数降序取前 N（同字数比标题，保证两端顺序一致）
    world_rank.sort(key=lambda t: (-t[0], t[1]))
    world_longest_list = [
        {"title": t, "chars": n, "id": wid} for n, t, wid in world_rank[:STATS_WORLD_RANK_N]
    ]

    world_block = {
        "total": len(worlds),
        "content_chars": content_chars,
        "main_category": _dist_pairs(main_counter),
        "longest": {"title": longest_entry[1], "chars": longest_entry[0]} if longest_entry else None,
    }

    # ---------- 关系 ----------
    cursor.execute("""
        SELECT r.*, c1.name AS from_name, c2.name AS to_name
        FROM relations r
        LEFT JOIN characters c1 ON r.from_char_id = c1.id
        LEFT JOIN characters c2 ON r.to_char_id = c2.id
        ORDER BY r.sort_order ASC, r.id ASC
    """)
    rels = [dict(r) for r in cursor.fetchall()]

    name_by_id = {c["id"]: c.get("name") or f"#{c['id']}" for c in chars}
    region_by_id = {c["id"]: _norm_bucket(c.get("region")) for c in chars}
    univ_by_id = {c["id"]: (c.get("university") or "").strip() for c in chars}

    type_counter = {}
    degree = {}
    pair_count = {}            # 无向配对 -> 关系条数（>1 说明重复）
    cross_counter = {}         # (地区A, 地区B) -> count
    mutual_pairs = set()       # 双向配对中"两端都指向对方"的
    directed_seen = set()      # 有向对 (from,to)，用于查互惠
    self_loop = 0
    dup_pairs = 0
    no_type = 0

    for r in rels:
        rt = (r.get("relation_type") or "").strip()
        if rt:
            type_counter[rt] = type_counter.get(rt, 0) + 1
        else:
            no_type += 1

        a, b = r.get("from_char_id"), r.get("to_char_id")
        if a == b:
            self_loop += 1
        pair = (a, b) if (a or 0) <= (b or 0) else (b, a)
        pair_count[pair] = pair_count.get(pair, 0) + 1
        directed_seen.add((a, b))

        # 关系度：两端各 +1（自环只 +1）
        degree[a] = degree.get(a, 0) + 1
        if a != b:
            degree[b] = degree.get(b, 0) + 1

        ra, rb = region_by_id.get(a), region_by_id.get(b)
        if ra and rb:
            region_total_rel[ra] = region_total_rel.get(ra, 0) + 1
            if ra != rb:
                region_total_rel[rb] = region_total_rel.get(rb, 0) + 1
            else:
                region_inside_rel[ra] = region_inside_rel.get(ra, 0) + 1
            key2 = (ra, rb) if ra <= rb else (rb, ra)
            cross_counter[key2] = cross_counter.get(key2, 0) + 1

    # 互惠关系：A→B 且 B→A 同时存在（任意类型）
    for (a, b) in directed_seen:
        if a != b and (b, a) in directed_seen:
            mutual_pairs.add(frozenset((a, b)))
    dup_pairs = sum(n - 1 for n in pair_count.values() if n > 1)
    explicit_pairs = len(pair_count)   # 手写关系去重后的配对数（家族配对并入前）

    # ---------- 家族关系：同家族的任意两人也算一条关系 ----------
    # 只用于"计数"（关系度 / 去重对数 / 地区矩阵 / 连通性 / 凝聚力 / 人均），
    # **不影响** 关系网的页面展示（那是另一套实现）。也不计入"数据质量"类指标
    # （total / 未标类型 / 重复关系 / 自环 / 互惠），那些描述的是用户手写的关系。
    fam_counter = {}           # 家族名 -> [角色 id]
    for c in chars:
        for f in _split_multi(c.get("family")):
            fam_counter.setdefault(f, []).append(c["id"])

    family_pair_set = set()    # 无向配对，同家族产生的
    for f, ids in fam_counter.items():
        uniq = sorted(set(ids))
        for i in range(len(uniq)):
            for j in range(i + 1, len(uniq)):
                family_pair_set.add((uniq[i], uniq[j]))

    # 把家族配对并入各项计数（不覆盖已存在的手写关系配对）
    family_new_pairs = 0       # 家族配对中，手写关系里没有的
    for (a, b) in family_pair_set:
        pair = (a, b)
        if pair in pair_count:
            continue            # 已有手写关系，不重复计入计数
        family_new_pairs += 1
        pair_count[pair] = pair_count.get(pair, 0) + 1
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1
        ra, rb = region_by_id.get(a), region_by_id.get(b)
        if ra and rb:
            region_total_rel[ra] = region_total_rel.get(ra, 0) + 1
            if ra != rb:
                region_total_rel[rb] = region_total_rel.get(rb, 0) + 1
            else:
                region_inside_rel[ra] = region_inside_rel.get(ra, 0) + 1
            key2 = (ra, rb) if ra <= rb else (rb, ra)
            cross_counter[key2] = cross_counter.get(key2, 0) + 1

    # 重新计算连通角色（家族关系可能让原本孤立的角色连上）
    connected_ids = set(degree.keys())
    isolated = [c for c in chars if c["id"] not in connected_ids]
    rank = sorted(degree.items(), key=lambda kv: (-kv[1], name_by_id.get(kv[0], "")))[:STATS_RANK_N]

    relations_block = {
        # total = 手写关系条数；unique_pairs = 去重后的"关系对"总数（**已含同家族配对**）
        "total": len(rels),
        "explicit_total": len(rels),
        "family_pairs": len(family_pair_set),
        "family_new_pairs": family_new_pairs,
        "unique_pairs": len(pair_count),
        "explicit_pairs": explicit_pairs,
        "self_loop": self_loop,
        "dup_pairs": dup_pairs,
        "no_type": no_type,
        "mutual_pairs": len(mutual_pairs),
        "connected_characters": len(connected_ids),
        "isolated_characters": len(isolated),
        "types": _dist_pairs(type_counter),
        "top_degree": [
            {
                "id": cid,
                "name": name_by_id.get(cid, f"#{cid}"),
                "degree": d,
                # 学校 / 地区：让统计页「关系度排行」与其它榜单一样能显示副行（crown-sub）。
                # 空地区归「未填写」，与角色分布口径一致；学校为空则前端自动不渲染副行。
                "university": univ_by_id.get(cid, ""),
                "region": region_by_id.get(cid, ""),
            }
            for cid, d in rank
        ],
        "isolated": [
            {"id": c["id"], "name": c.get("name") or "", "region": c.get("region") or ""}
            for c in isolated[:STATS_RANK_N]
        ],
        "cross_region": [
            {"from": k[0], "to": k[1], "count": v}
            for k, v in sorted(cross_counter.items(), key=lambda kv: (-kv[1], kv[0]))[:STATS_MAX_CROSS]
        ],
    }

    # ---------- 地区凝聚力 + 设定厚度 ----------
    cohesion = []
    for r, total in region_total_rel.items():
        if total < STATS_MIN_REGION:
            continue
        inside = region_inside_rel.get(r, 0)
        n_chars = region_char_count.get(r, 0)
        sum_setting = region_setting_sum.get(r, 0)
        cohesion.append({
            "name": r,
            "characters": n_chars,
            "total": total,
            "inside": inside,
            "outside": total - inside,
            "cohesion": _round1(inside / total * 100) if total else 0.0,
            # 取整到字：与前端一样的「远离零」规则，避免 .5 时差 1
            "avg_setting": _round0(sum_setting / n_chars) if n_chars else 0,
        })
    cohesion.sort(key=lambda x: (-x["cohesion"], x["name"]))
    region_block = cohesion

    # ---------- 设定完整度体检 ----------
    completeness = []
    missing_map = {}   # 字段 -> 待补充角色名列表
    for field, label in STATS_COMPLETENESS_FIELDS:
        filled = 0
        missing_names = []
        for c in chars:
            if field == "images":
                ok = bool(c.get("images"))
            elif field == "face_crop":
                ok = bool((c.get("face_crop") or "").strip())
            else:
                ok = bool((c.get(field) or "").strip())
            if ok:
                filled += 1
            else:
                missing_names.append(c.get("name") or f"#{c['id']}")
        total = len(chars) or 1
        completeness.append({
            "field": field,
            "label": label,
            "filled": filled,
            "missing": len(chars) - filled,
            "pct": _round1(filled / total * 100),
        })
        if missing_names:
            missing_map[field] = missing_names[:STATS_RANK_N]

    # 平均完整度（按字段百分比取均值）
    avg_completeness = _round1(
        sum(item["pct"] for item in completeness) / len(completeness)
    ) if completeness else 0.0

    completeness_block = {
        "fields": completeness,
        "avg_pct": avg_completeness,
        "missing": missing_map,
        "label_map": {f: l for f, l in STATS_COMPLETENESS_FIELDS},
    }

    # ---------- 家族规模 ----------
    family_block = [
        {"name": k, "count": v} for k, v in
        sorted(family_counter.items(), key=lambda kv: (-kv[1], kv[0]))[:STATS_TOP_N]
    ]
    family_with = sum(1 for c in chars if (c.get("family") or "").strip())
    family_summary = {
        "families": len(family_counter),
        "with_family": family_with,
        "without_family": len(chars) - family_with,
        "list": family_block,
    }

    # ---------- 角色之最 ----------
    def _top(score_fn, limit=STATS_RANK_N):
        scored = [(c, score_fn(c)) for c in chars]
        scored = [(c, s) for c, s in scored if s]
        scored.sort(key=lambda cs: (-cs[1], cs[0].get("name") or ""))
        return [
            {"id": c["id"], "name": c.get("name") or "", "region": c.get("region") or "",
             "university": c.get("university") or "", "value": s}
            for c, s in scored[:limit]
        ]

    # 每个角色的关系类型种数
    type_kinds = {}
    for r in rels:
        rt = (r.get("relation_type") or "").strip()
        if not rt:
            continue
        for cid in (r.get("from_char_id"), r.get("to_char_id")):
            type_kinds.setdefault(cid, set()).add(rt)

    highlights = {
        "longest_setting": _top(lambda c: _char_text_len(c.get("setting"))),
        "most_relations": _top(lambda c: degree.get(c["id"], 0)),
        "richest_types": _top(lambda c: len(type_kinds.get(c["id"], ()))),
        "most_images": _top(lambda c: len(c.get("images") or [])),
        "most_family": _top(lambda c: len(_split_multi(c.get("family")))),
    }

    # 设定篇幅分布（按字数分档，比"最短"更有信息量）
    buckets = [
        ("≥1000 字", lambda n: n >= 1000),
        ("500–999 字", lambda n: 500 <= n < 1000),
        ("200–499 字", lambda n: 200 <= n < 500),
        ("1–199 字", lambda n: 0 < n < 200),
        ("未填写", lambda n: n == 0),
    ]
    setting_dist = []
    for label, pred in buckets:
        cnt = sum(1 for c in chars if pred(_char_text_len(c.get("setting"))))
        if cnt or label == "未填写":
            setting_dist.append({"name": label, "count": cnt})

    world_longest = None
    if longest_entry and longest_entry[0]:
        world_longest = {"title": longest_entry[1], "chars": longest_entry[0]}

    highlights_block = {
        "items": highlights,
        "world_longest": world_longest,
        "world_longest_list": world_longest_list,
        "setting_distribution": setting_dist,
        "total_setting_chars": sum(_char_text_len(c.get("setting")) for c in chars),
    }

    # ---------- 文档 ----------
    doc_count = 0
    doc_bytes = 0
    if os.path.exists(UPLOAD_DIR):
        for fname in os.listdir(UPLOAD_DIR):
            fpath = os.path.join(UPLOAD_DIR, fname)
            if os.path.isfile(fpath):
                doc_count += 1
                try:
                    doc_bytes += os.path.getsize(fpath)
                except OSError:
                    pass
    documents_block = {
        "total": doc_count,
        "size_display": format_size(doc_bytes),
        "size_bytes": doc_bytes,
    }

    if os.path.exists(IMAGE_DIR):
        image_files = [f for f in os.listdir(IMAGE_DIR) if os.path.isfile(os.path.join(IMAGE_DIR, f))]
    else:
        image_files = []
    image_block = {
        "files": len(image_files),
        "size_display": format_size(sum(os.path.getsize(os.path.join(IMAGE_DIR, f)) for f in image_files)),
    }

    conn.close()

    return {
        "generated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
        "characters": characters_block,
        "worldview": world_block,
        "relations": relations_block,
        "regions": region_block,
        "completeness": completeness_block,
        "families": family_summary,
        "highlights": highlights_block,
        "documents": documents_block,
        "images": image_block,
    }


# 数据同步 API（供手机端上传/下载全量数据）
# ============================================================
from pydantic import BaseModel as PydanticModel
from typing import Any

class SyncPayload(PydanticModel):
    characters: list[dict[str, Any]] = []
    worldBuildings: list[dict[str, Any]] = []
    relations: list[dict[str, Any]] = []


@app.post("/api/sync/replace-all")
def sync_replace_all(payload: SyncPayload):
    """全量替换服务器数据（手机上传用）"""
    print(f"[sync/replace-all] 收到请求: {len(payload.characters)} 角色, {len(payload.worldBuildings)} 设定, {len(payload.relations)} 关系")
    conn = get_db()
    cursor = conn.cursor()

    # 替换角色
    cursor.execute("DELETE FROM characters")
    for c in payload.characters:
        # images 字段在客户端是 list，数据库存为 JSON 字符串
        if "images" in c and isinstance(c["images"], list):
            c["images"] = json.dumps(c["images"])
        cols = list(c.keys())
        placeholders = ",".join(["?"] * len(cols))
        col_names = ",".join(cols)
        values = [c[col] for col in cols]
        cursor.execute(f"INSERT INTO characters ({col_names}) VALUES ({placeholders})", values)

    # 替换世界设定
    cursor.execute("DELETE FROM world_buildings")
    for w in payload.worldBuildings:
        cols = list(w.keys())
        placeholders = ",".join(["?"] * len(cols))
        col_names = ",".join(cols)
        values = [w[col] for col in cols]
        cursor.execute(f"INSERT INTO world_buildings ({col_names}) VALUES ({placeholders})", values)

    # 替换关系（过滤掉前端附带的展示字段 from_name / to_name，它们不是数据库列）
    cursor.execute("DELETE FROM relations")
    for r in payload.relations:
        r = {k: v for k, v in r.items() if k not in ("from_name", "to_name")}
        cols = list(r.keys())
        placeholders = ",".join(["?"] * len(cols))
        col_names = ",".join(cols)
        values = [r[col] for col in cols]
        cursor.execute(f"INSERT INTO relations ({col_names}) VALUES ({placeholders})", values)

    conn.commit()
    conn.close()
    return {
        "message": "同步成功",
        "characters": len(payload.characters),
        "worldBuildings": len(payload.worldBuildings),
        "relations": len(payload.relations),
    }


@app.get("/index")
def serve_index_page():
    # 统计页「角色之最」「关系度排行」生成的是 /index?char=ID；缺了这条路由会 404。
    return FileResponse(os.path.join(DESKTOP_DIR, "index.html"))


@app.get("/worldview")
def serve_worldview():
    return FileResponse(os.path.join(DESKTOP_DIR, "worldview.html"))


@app.get("/documents")
def serve_documents():
    return FileResponse(os.path.join(DESKTOP_DIR, "documents.html"))


@app.get("/relations")
def serve_relations():
    return FileResponse(os.path.join(DESKTOP_DIR, "relations.html"))


@app.get("/stats")
def serve_stats():
    return FileResponse(os.path.join(DESKTOP_DIR, "stats.html"))


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(DESKTOP_DIR, "index.html"))


@app.get("/search.js")
def serve_search_js():
    return FileResponse(os.path.join(DESKTOP_DIR, "search.js"), media_type="application/javascript")


@app.get("/export-all.js")
def serve_export_all_js():
    return FileResponse(os.path.join(DESKTOP_DIR, "export-all.js"), media_type="application/javascript")


@app.get("/copy-detail.js")
def serve_copy_detail_js():
    return FileResponse(os.path.join(DESKTOP_DIR, "copy-detail.js"), media_type="application/javascript")


@app.get("/face-crop.js")
def serve_face_crop_js():
    return FileResponse(os.path.join(DESKTOP_DIR, "face-crop.js"), media_type="application/javascript")


# ============================================================
# 移动版页面（手机专用，路径前缀 /m）
# ============================================================
@app.get("/m")
def serve_m_index():
    return FileResponse(os.path.join(MOBILE_DIR, "m-index.html"))


@app.get("/m/worldview")
def serve_m_worldview():
    return FileResponse(os.path.join(MOBILE_DIR, "m-worldview.html"))


@app.get("/m/relations")
def serve_m_relations():
    return FileResponse(os.path.join(MOBILE_DIR, "m-relations.html"))


@app.get("/m/documents")
def serve_m_documents():
    return FileResponse(os.path.join(MOBILE_DIR, "m-documents.html"))


# 托管静态文件（桌面版页面目录）
_desktop_index = os.path.join(DESKTOP_DIR, "index.html")
if os.path.exists(_desktop_index):
    app.mount("/static", StaticFiles(directory=DESKTOP_DIR, html=True), name="static")

# 托管图片目录
if os.path.exists(IMAGE_DIR):
    app.mount("/images", StaticFiles(directory=IMAGE_DIR), name="images")


if __name__ == "__main__":
    import uvicorn
    # 解析命令行参数
    parser = argparse.ArgumentParser(description="高校拟人 OC 设定管理 - FastAPI 后端")
    parser.add_argument("--port", type=int, default=8000, help="服务端口（默认 8000）")
    args = parser.parse_args()

    print(f"启动服务: http://0.0.0.0:{args.port}")
    print(f"访问桌面版: http://localhost:{args.port}/")
    uvicorn.run(app, host="0.0.0.0", port=args.port)
