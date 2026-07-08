"""
高校拟人OC 设定管理 - FastAPI 后端
"""

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
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import Optional, List
import uuid

# 路径配置：基于本文件所在目录
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DB_PATH = os.path.join(BASE_DIR, "oc_characters.db")
UPLOAD_DIR = os.path.join(BASE_DIR, "文字设定")
DESKTOP_DIR = os.path.join(BASE_DIR, "..", "web-desktop")
MOBILE_DIR = os.path.join(BASE_DIR, "..", "web-mobile")
IMAGE_DIR = os.path.join(BASE_DIR, "images")

# 确保上传目录存在
os.makedirs(UPLOAD_DIR, exist_ok=True)
os.makedirs(IMAGE_DIR, exist_ok=True)


def init_db():
    """初始化数据库，创建角色表与世界设定表"""
    conn = sqlite3.connect(DB_PATH)
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
    for col_name in ["university", "region", "naming_rationale", "family", "birthplace", "status", "image_url"]:
        if col_name not in cols:
            cursor.execute(f"ALTER TABLE characters ADD COLUMN {col_name} TEXT DEFAULT ''")
    if "sort_order" not in cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN sort_order INTEGER DEFAULT 0")
        cursor.execute("UPDATE characters SET sort_order = id")
    # 新增多图字段 images（JSON 数组），并把旧 image_url 迁移为 images 首项
    if "images" not in cols:
        cursor.execute("ALTER TABLE characters ADD COLUMN images TEXT DEFAULT '[]'")
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


app = FastAPI(title="高校拟人OC 设定管理", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# --- 数据模型 ---

class CharacterCreate(BaseModel):
    name: str = Field(..., description="姓名")
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


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
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


class CharacterResponse(BaseModel):
    id: int
    name: str
    university: str
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
    relation_type: str = Field(default="", description="关系类型，如：好友、对手、师徒等")
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


def get_db():
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
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
           (name, university, region, naming_rationale, height, gender, birthday, appearance,
            identity_period, birth_time, setting, family, birthplace, status, image_url, images, sort_order, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (data.name, data.university, data.region, data.naming_rationale,
         data.height, data.gender, data.birthday,
         data.appearance, data.identity_period, data.birth_time,
         data.setting, data.family, data.birthplace, data.status, data.image_url, json.dumps(data.images), next_order, now, now)
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
    for field in ["name", "university", "region", "naming_rationale", "height", "gender", "birthday", "appearance",
                  "identity_period", "birth_time", "setting", "family", "birthplace", "status", "image_url"]:
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
    """校验并保存上传的图片，返回 (image_url, filename)"""
    if not file.filename:
        raise HTTPException(status_code=400, detail="文件名为空")
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"不支持的图片类型: {ext}，仅支持 {', '.join(ALLOWED_IMAGE_EXTENSIONS)}"
        )
    unique_filename = f"{uuid.uuid4().hex}{ext}"
    image_path = os.path.join(IMAGE_DIR, unique_filename)
    try:
        with open(image_path, "wb") as f:
            content = await file.read()
            f.write(content)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"图片保存失败: {str(e)}")
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
    conn = get_db()
    cursor = conn.cursor()

    # 替换角色
    cursor.execute("DELETE FROM characters")
    for c in payload.characters:
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

    # 替换关系（过滤掉 api-shim 添加的 from_name / to_name）
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


@app.get("/worldview")
def serve_worldview():
    return FileResponse(os.path.join(DESKTOP_DIR, "worldview.html"))


@app.get("/documents")
def serve_documents():
    return FileResponse(os.path.join(DESKTOP_DIR, "documents.html"))


@app.get("/relations")
def serve_relations():
    return FileResponse(os.path.join(DESKTOP_DIR, "relations.html"))


@app.get("/")
def serve_index():
    return FileResponse(os.path.join(DESKTOP_DIR, "index.html"))


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
    uvicorn.run(app, host="0.0.0.0", port=8000)
