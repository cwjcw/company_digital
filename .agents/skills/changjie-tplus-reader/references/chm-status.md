# 用户上传的 T+19.0 数据字典状态

- 原始文件：`assets/Tplus19.0DataDic.chm`（从用户本轮上传复制）
- SHA-256：`851ac21139ca2a0addc0d114f4d387f359ede3fb612ab90f0636afcea3c6e6eb`
- 文件大小：2,736,946 字节
- 文件格式：Microsoft Compiled HTML Help / ITSF
- 从 CHM 内部目录结构独立解析得到：2,832 项目录记录，2,799 个 HTML 条目
- 存储类型：2817 个记录位于 MSCompressed 内容流（另有15个非压缩目录/资源条目）
- 正文内容：**尚未提取**；本环境无 `7z` / `extract_chmLib` 且不便自动安装，因此尚未核实文件内部任何表字段。
- 注意：本 Skill 的候选表名来自 T+ 公开字典，真实表/字段需要以科加数据库验证结果为准。

## 使用方法

在安装此技能的项目根目录运行：

```bash
python .agents/skills/changjie-tplus-reader/scripts/chm_index.py --metadata
```

如运行机器已有支持 CHM 的 `7z`、`7zz` 或 `extract_chmLib`，可继续：

```bash
python .agents/skills/changjie-tplus-reader/scripts/chm_index.py --extract
```

解压结果保存在 `.agents/skills/changjie-tplus-reader/working/chm-pages/`，关键词索引保存在 `working/chm-keyword-index.tsv`。全文可能包含大量结构，不应未经检验直接喂入模型；先找到相关表页面，对照真实 SQL Server 字段再更新参考映射。
