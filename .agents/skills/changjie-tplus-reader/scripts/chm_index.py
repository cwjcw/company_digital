#!/usr/bin/env python3
"""分析 T+19 CHM 的目录（纯标准库）；若系统已有 CHM 解压器，可进一步提取全文。"""
from __future__ import annotations
import argparse
from collections import Counter
from hashlib import sha256
from html.parser import HTMLParser
from pathlib import Path
import csv
import json
import re
import shutil
import struct
import subprocess
import sys

SKILL = Path(__file__).resolve().parents[1]
CHM = SKILL / 'assets' / 'Tplus19.0DataDic.chm'
WORK = SKILL / 'working'


def vint(buf, position):
    result = 0
    for _ in range(10):
        if position >= len(buf):
            raise ValueError('unexpected directory end')
        v = buf[position]
        position += 1
        result = (result << 7) | (v & 0x7f)
        if v < 128:
            return result, position
    raise ValueError('invalid CHM variable integer')


def inspect_chm(path):
    b = path.read_bytes()
    if b[:4] != b'ITSF':
        raise ValueError('Not a CHM / ITSF file')
    directory_offset, directory_size = struct.unpack_from('<QQ', b, 0x48)
    if b[directory_offset:directory_offset+4] != b'ITSP':
        raise ValueError('CHM directory signature missing')
    hdr_size = struct.unpack_from('<I', b, directory_offset+8)[0]
    chunk_size = struct.unpack_from('<I', b, directory_offset+0x10)[0]
    entries = []
    for block_start in range(directory_offset + hdr_size, directory_offset + directory_size, chunk_size):
        block = b[block_start:block_start+chunk_size]
        if block[:4] != b'PMGL':
            continue
        end = chunk_size - struct.unpack_from('<I', block, 4)[0]
        pos = 20
        while pos < end:
            n, pos = vint(block, pos)
            name = block[pos:pos+n].decode('utf-8', errors='replace')
            pos += n
            section, pos = vint(block, pos)
            offset, pos = vint(block, pos)
            length, pos = vint(block, pos)
            entries.append({'path': name, 'section': section, 'offset': offset, 'length': length})
    return {'file': path.name, 'size': len(b), 'sha256': sha256(b).hexdigest(),
            'format': 'Microsoft HTML Help / ITSF',
            'entry_count': len(entries),
            'html_entries': sum(e['path'].lower().endswith('.html') for e in entries),
            'sections': dict(Counter(e['section'] for e in entries)), 'entries': entries}


class HtmlText(HTMLParser):
    def __init__(self):
        super().__init__()
        self.in_title = False
        self.ignoring = False
        self.text = []
        self.title = []
    def handle_starttag(self, tag, attrs):
        if tag == 'title': self.in_title = True
        if tag in ('script', 'style'): self.ignoring = True
    def handle_endtag(self, tag):
        if tag == 'title': self.in_title = False
        if tag in ('script', 'style'): self.ignoring = False
    def handle_data(self, data):
        if self.ignoring: return
        if self.in_title: self.title.append(data)
        else: self.text.append(data)


def scan_pages(folder):
    keywords = ['工艺', '工序', '路线', 'Routing', 'ProductProcess', 'BOM', 'Manufactur', '加工单']
    result = []
    for page in sorted(folder.rglob('*')):
        if not page.is_file() or page.suffix.lower() not in ('.htm', '.html', '.hhc', '.hhk'):
            continue
        data = page.read_bytes()
        content = None
        for enc in ('utf-8-sig', 'gb18030'):
            try:
                content = data.decode(enc)
                break
            except UnicodeDecodeError: pass
        if content is None: content = data.decode('utf-8', errors='replace')
        doc = HtmlText()
        doc.feed(content)
        summary = re.sub(r'\s+', ' ', ' '.join(doc.text)).strip()
        matches = [kw for kw in keywords if kw.casefold() in (summary + ' '.join(doc.title)).casefold()]
        if matches:
            snippets = []
            for kw in matches[:3]:
                idx = summary.casefold().find(kw.casefold())
                if idx >= 0: snippets.append(summary[max(0,idx-50):idx+120])
            result.append({'path': str(page.relative_to(folder)), 'title': ' '.join(doc.title).strip(),
                           'keywords': ','.join(matches), 'snippets': ' | '.join(snippets)[:500]})
    return result


def main():
    p = argparse.ArgumentParser(description='只读解析已上传的 T+ 19.0 CHM 目录 / 按需离线解压')
    mode = p.add_mutually_exclusive_group(required=True)
    mode.add_argument('--metadata', action='store_true', help='解析无需解压的 CHM 文件目录')
    mode.add_argument('--extract', action='store_true', help='使用现有的 7z 或 extract_chmLib 解压并生成检索索引')
    args = p.parse_args()
    data = inspect_chm(CHM)
    print(json.dumps({k:v for k,v in data.items() if k != 'entries'}, ensure_ascii=False, indent=2))
    if not args.extract:
        print('示例：', ', '.join(x['path'] for x in data['entries'][-4:]))
        print('注意：仅识别了 CHM 目录。正文条目采用压缩存储；目前尚未从目录推断任何业务字段。')
        return
    unpack = shutil.which('7z') or shutil.which('7zz') or shutil.which('extract_chmLib')
    if not unpack:
        print('尚无 CHM 解压器：请在具备 7z / 7zz / extract_chmLib 的机器上重试；脚本没有安装任何软件。',file=sys.stderr)
        raise SystemExit(2)
    out = WORK / 'chm-pages'
    out.mkdir(parents=True, exist_ok=True)
    if Path(unpack).name.startswith('7z'):
        cmd = [unpack,'x',f'-o{out}','-y',str(CHM)]
    else:
        cmd = [unpack,str(CHM),str(out)]
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)
    matches = scan_pages(out)
    path = WORK / 'chm-keyword-index.tsv'
    with path.open('w',newline='',encoding='utf-8-sig') as f:
        writer = csv.DictWriter(f, fieldnames=['path','title','keywords','snippets'],delimiter='\t')
        writer.writeheader()
        writer.writerows(matches)
    print(f'已检索 {len(matches)} 个关键词相关条目：{path}')
    print('检查关键词索引和目标正文后，才能更新字段映射证据。')

if __name__ == '__main__':
    main()
