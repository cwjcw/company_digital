# Knowledge 2.1 Phase B

前端代码与自动化验证、最终上线和真实管理员验收均已完成。统一新建入口提供在线编写与上传文件；单批最多20个文件，逐文件进度/成功草稿ID/错误独立保留，失败项复用同一幂等键重试。目标Space/父页面沿用现有Page树；上传不自动发布。

FILE Page统一编辑标题/标签/说明/主文件替换/补充附件/发布；原富文本页继续TipTap串行autosave，正文图片粘贴和拖放标记INLINE，附件选择标记SUPPLEMENTAL。界面隐藏工作修订技术数字并保留乐观version机制，标签有“添加标签...”占位，显示所在位置。

PDF.js真实canvas，Header认证、不使用URL token；65536字节Range、页码跳转、缩放、全屏、进度、原件下载、处理中与失败重试。Word/PPT/Excel通过派生PDF读取；Excel明确提示打印区域分页及完整内容需要原件。图片/TXT使用授权Blob，TXT截取前200KB。历史版本使用versionId且原件/预览共享版本关系授权。

前端专项6文件36项PASS；完整Web35文件248项PASS。Playwright实际Chrome+当前Vite+fixture API的原Knowledge回归3项PASS，环境凭据测试1项按条件跳过；实际生产管理员单独通过运行时凭据验收，不将fixture测试冒称生产验证。全workspace类型检查/lint/build PASS，原Portal1条lint警告及现有build chunk警告保留。

后续隔离Office转换、备份/迁移/部署、健康/SHA一致及18项真实管理员验收均已完成。生产员工账号未获授权，不修改权限，不虚报员工线上PASS；员工数据权限由数据库/HTTP/前端fixture自动测试覆盖。

最终交付：2c68cc5部署完成，HEAD/Web/API/Worker一致、四服务healthy，真实管理员18项PASS；详见KNOWLEDGE_2_1_ACCEPTANCE.md。
