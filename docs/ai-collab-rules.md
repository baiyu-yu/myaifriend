# AI 协作与 Git 同步规范

本文档用于约束后续 AI 编程工具在本仓库中的工作方式。

## 1. 修改原则
- 所有注释与 GUI 内文案默认使用中文。
- 每次变更必须可编译、可运行，不提交明显损坏状态。
- 修改前先阅读相关文件，避免覆盖用户未要求改动。

## 2. 每次修改后的固定流程（必须执行）
1. 代码检查
```bash
npx tsc -p tsconfig.main.json --noEmit
npx vue-tsc -p tsconfig.renderer.json --noEmit
```

2. 查看变更
```bash
git status
git diff
```

3. 提交到本地
```bash
git add -A
git commit -m "feat: <简要说明本次改动>"
```

4. 同步到远程仓库
```bash
git push origin <当前分支名>
```

## 3. 提交信息建议
- `feat:` 新功能
- `fix:` 缺陷修复
- `refactor:` 重构
- `docs:` 文档改动
- `test:` 测试改动

## 4. 失败处理
- 如果类型检查失败，先修复再提交。
- 如果 `git push` 失败（鉴权/网络），必须在输出中明确失败原因并给出下一步处理建议，不得假装成功。
