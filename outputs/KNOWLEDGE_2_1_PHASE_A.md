# Knowledge2.1 Phase A

核心后端实现已完成，专项90项、隔离DB76场景和85个新安装migration通过。HTTP集成5项已通过；独立镜像和无网络/非root的DOCX/DOC/PPTX/PPT/XLSX/XLS六种实际转换均PASS。最终生产上线/健康与18项管理员验收均已完成，详情见最终报告。

保留Knowledge2.0 Space/Page树、授权服务、发布快照、富文本导入、审计、自动保存串行版本机制。旧附件表迁移重命名为knowledge_file_assets；原page_id保留为来源归属，实际工作稿角色绑定用knowledge_page_files，发布关系重命名为knowledge_page_version_files并增加role。没有并存两套资产表；不修改旧migration。工作关系唯一主文件，发布关系唯一主文件及不可变触发器；资产元数据也不可覆盖。

统一处理表knowledge_file_previews承载持久化任务与派生预览，原件/fileId/sha256/转换器版本为幂等身份；原子SKIP LOCKED领取、租约、三次崩溃恢复上限、FAILED保留原件、管理员显式重试、旧租约拒绝。文件创建请求另持久化actor/tenant/idempotencyKey，以单文件命令支撑部分成功的批量上传。

ObjectStorage兼容原公共Buffer调用，新增Readable写入、stat和有界openStream；Knowledge原件/预览读取只经授权后流式发送，Range206/416与HEAD具备相同授权。磁盘Multer暂存→有界签名/统一加密检测/Office ZIP验证→流式hash/私有写入→Application事务文件关系/任务。100MB上限可在1..100MB配置；Rich文档转正文导入仍维持合理20MB解析限制。Nginx104MB为multipart预留空间。

独立document-worker镜像安装LibreOffice，API runtime不安装。非root、CPU1/1536MB/pids128、只读根、tmpfs512MB、cap-drop/no-new-privileges、只有PostgreSQL的internal网络、无公开端口；转换超时杀进程组，独立profile高等级宏策略，输出仅PDF，原件hash验证，临时目录finally清理。派生文件不修改Published业务快照。

Phase B继续完成浏览器/实际转换验收、增强专项与完整回归、备份迁移统一部署；员工真实账号未获授权，不修改生产用户授权进行验收。最终准确状态以KNOWLEDGE_2_1_ACCEPTANCE.md为准。

最终交付：2c68cc5部署完成，HEAD/Web/API/Worker一致、四服务healthy，真实管理员18项PASS；详见KNOWLEDGE_2_1_ACCEPTANCE.md。
