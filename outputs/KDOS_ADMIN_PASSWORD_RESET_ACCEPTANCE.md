# 系统管理员手工重置密码验收

状态：功能代码已上线，等待管理员人工验收。生产登录后实际重置操作未验证，不将隔离验证冒充生产员工操作。

## 功能

- 路径：系统管理 → 用户管理 → 成员行操作 → 重置密码；成员编辑抽屉底部也提供同一功能。
- 确认弹窗显示姓名、账号、默认密码和下次登录必须改密；取消不提交，忙时防重复点击。
- 默认密码沿用现有系统规则，不改变角色、权限、部门及账号启停状态。内置admin账号保持受保护。
- 仅系统管理员显示入口；后台重新校验真实启用用户、所属租户与正式管理员授权，不能靠前端隐藏代替授权。
- 沿用POST /api/v1/admin/users/:id/reset-password；Controller委托AdminApplicationService，目标租户行锁、可选expectedVersion（新页面必传）、事务审计。审计及响应均不含密码/哈希。
- 服务端提交成功后才刷新；刷新失败保留明确结果并只重试刷新，不再次发重置请求；403/409和其他真实错误可见。

## 文件和版本

起始SHA：5477b3702306a7917bc91caa5b48c9aee917f4f9。

最终Repository/Web/API/GitHub main：6aedfdc220ae071ea3a05bf88875811bbac532be；标准deploy all/check成功，STATUS=CONSISTENT，API/Web/PostgreSQL/Document Worker健康。

本轮8文件：API controllers.ts、admin-application.service.ts、admin-password-reset.spec.ts；Web AdminWorkspace.tsx、AdminWorkspace.spec.tsx、ResetPasswordModal.tsx、ResetPasswordModal.spec.tsx；docs/runbook.md。正常commit/push，无force；先前ERP调查完整版及上一任务报告未提交。

Migration：无。生产仍为原103项迁移，未修改权限组、6项同步flags、财务视图或PMC映射。

## 验证

- 新增API专项9项；admin/auth回归8套56项全部通过。
- Web专项/原用户管理14项全部通过，包含入口/可见性、确认取消、版本随请求、重复点击、真实错误和刷新失败重试。
- 隔离PostgreSQL/真实HTTP10组通过：默认bcrypt密码、强制改密、停用状态保留、非管理员403、跨租户拒绝、admin保护、旧版本409、真实审计约束失败全回滚、并发只一次成功、已撤销授权/停用操作人拒绝。
- 真实Chrome153：列表及编辑入口、取消零提交、双击仅1个POST、隔离HTTP/数据库真实提交、账号状态/强制改密/密码正确、admin项禁用全部通过。全部成功写入仅发生于已销毁的隔离库。
- 递归typecheck、lint、build通过；lint0错误，保留既有ModulePortal FastRefresh警告和Vite大包提示。测试修正仅处理AntD动画及测试环境重复aria标签，未弱化生产授权或业务校验。
- 生产Chrome：目标/users可打开HTTP200；实际生产JS包含新重置UI；新API无登录请求返回401；Web/API SHA一致。**由于服务器现存管理员初始密码失效，未伪造登录、未进行生产登录后的按钮/确认验收，未重置任何真实员工账号。**

## 保护及待验收

141154两库与附件备份完成；三份SHA-256、600权限、pg_restore目录及tar列表验证通过。未向生产恢复演练，恢复仅应先进入隔离空库/附件暂存目录。

发布前后9项权限/映射摘要、6flags及8个财务视图摘要完全一致；评审交期主表/历史仍0/0。未导入真实Excel、未做品项编码更正、未添加或变更任何调度。

隔离HTTP/Vite进程、测试PostgreSQL容器与匿名卷已清理；受限证据为data/admin-password-reset-20261022，不提交凭据或业务数据。

管理员可在正式页面自行核对成员并确认重置。本次先前请求的00117密码尚未实际重置；无需Codex直接操作数据库，也不会把功能上线冒充该用户密码已重置。生产登录后操作仍待人工验收。
