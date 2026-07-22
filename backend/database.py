import sqlite3
import json
import os
from typing import List, Dict, Any, Optional
from datetime import datetime

# 内存 SQLite 数据库单例，保持全生命周期 open
_MEMORY_CONN = sqlite3.connect(":memory:", check_same_thread=False)
_MEMORY_CONN.row_factory = sqlite3.Row

def get_db_connection():
    return _MEMORY_CONN

def init_db():
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute('''
    CREATE TABLE IF NOT EXISTS posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        original_title TEXT,
        original_content TEXT,
        author TEXT,
        likes INTEGER DEFAULT 0,
        original_images TEXT,
        source_url TEXT,
        status TEXT DEFAULT 'SCRAPED',
        ai_title TEXT,
        ai_content TEXT,
        ai_tags TEXT,
        ai_images TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
    ''')
    conn.commit()

def parse_post_row(row: sqlite3.Row) -> Dict[str, Any]:
    data = dict(row)
    for field in ["original_images", "ai_tags", "ai_images"]:
        val = data.get(field)
        if isinstance(val, str) and val.strip():
            try:
                data[field] = json.loads(val)
            except Exception:
                data[field] = []
        else:
            data[field] = []
    return data

def add_post(original_title: str, original_content: str, author: str = "", likes: int = 0, 
             original_images: List[str] = None, source_url: str = "") -> int:
    conn = get_db_connection()
    cursor = conn.cursor()
    images_json = json.dumps(original_images or [])
    cursor.execute('''
        INSERT INTO posts (original_title, original_content, author, likes, original_images, source_url)
        VALUES (?, ?, ?, ?, ?, ?)
    ''', (original_title, original_content, author, likes, images_json, source_url))
    post_id = cursor.lastrowid
    conn.commit()
    return post_id

def get_posts(status: Optional[str] = None) -> List[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    if status:
        cursor.execute("SELECT * FROM posts WHERE status = ? ORDER BY id DESC", (status,))
    else:
        cursor.execute("SELECT * FROM posts ORDER BY id DESC")
    rows = cursor.fetchall()
    return [parse_post_row(row) for row in rows]

def get_post_by_id(post_id: int) -> Optional[Dict[str, Any]]:
    conn = get_db_connection()
    cursor = conn.cursor()
    cursor.execute("SELECT * FROM posts WHERE id = ?", (post_id,))
    row = cursor.fetchone()
    return parse_post_row(row) if row else None

def update_ai_replication(post_id: int, ai_title: str, ai_content: str, ai_tags: List[str], ai_images: List[str]):
    conn = get_db_connection()
    cursor = conn.cursor()
    tags_json = json.dumps(ai_tags or [])
    images_json = json.dumps(ai_images or [])
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    cursor.execute('''
        UPDATE posts 
        SET ai_title = ?, ai_content = ?, ai_tags = ?, ai_images = ?, status = 'AI_GENERATED', updated_at = ?
        WHERE id = ?
    ''', (ai_title, ai_content, tags_json, images_json, now, post_id))
    conn.commit()

def update_human_review(post_id: int, status: str, ai_title: str = None, ai_content: str = None, 
                        ai_tags: List[str] = None, ai_images: List[str] = None):
    conn = get_db_connection()
    cursor = conn.cursor()
    now = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    
    if ai_title is not None and ai_content is not None:
        tags_json = json.dumps(ai_tags or [])
        images_json = json.dumps(ai_images or [])
        cursor.execute('''
            UPDATE posts 
            SET status = ?, ai_title = ?, ai_content = ?, ai_tags = ?, ai_images = ?, updated_at = ?
            WHERE id = ?
        ''', (status, ai_title, ai_content, tags_json, images_json, now, post_id))
    else:
        cursor.execute('''
            UPDATE posts SET status = ?, updated_at = ? WHERE id = ?
        ''', (status, now, post_id))
        
    conn.commit()
