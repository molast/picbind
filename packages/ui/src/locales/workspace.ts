import type { Lang } from "./index";

export type WorkspaceLabels = {
  [key: string]: string;
  collaborating: string;
  gallery: string;
  imageWorkspace: string;
  chooseImages: string;
  operationLog: string;
  imagesStayLocal: string;
  originLibrary: string;
  chooseOriginal: string;
  chooseOrDropOriginals: string;
  workingProcessing: string;
  processCollaborate: string;
  workingEmpty: string;
  addFromOrigin: string;
  collaboration: string;
  collaborators: string;
  noCollaborators: string;
  viewingWorkspace: string;
  directConnection: string;
  relayedConnection: string;
  packetLoss: string;
  activity: string;
  messages: string;
  noMessages: string;
  workspaceSettings: string;
  workspaceStyleEditor: string;
  stylePreview: string;
  imageInformation: string;
  selectImage: string;
  workspaceOverview: string;
  imagesTotal: string;
  inWorking: string;
  workspaceShare: string;
  createPermanentLink: string;
  createShareLink: string;
  createNewLink: string;
  copyShareLink: string;
  shareLinkCopied: string;
  copyWorkspaceId: string;
  workspaceIdCopied: string;
  shareId: string;
  ownerOffline: string;
  loadingWorkspace: string;
  workspaceUnavailable: string;
  openMyWorkspace: string;
  returnHome: string;
  leaveWorkspace: string;
  leaveWorkspaceQuestion: string;
  leaveWorkspaceDescription: string;
  stopCollaborationQuestion: string;
  stopCollaborationDescription: string;
  stoppingCollaboration: string;
  stopDirectly: string;
  saveAndStopCollaboration: string;
  saveImageQuestion: string;
  saveImageConfirmationDescription: string;
  sourceFileSize: string;
  downloading: string;
  downloadComplete: string;
  cancel: string;
  close: string;
  confirm: string;
  save: string;
  accept: string;
  reject: string;
  preview: string;
  approve: string;
  later: string;
  removeCollaborator: string;
  removeCollaboratorQuestion: string;
  removeCollaboratorDescription: string;
  confirmRemoveCollaborator: string;
  removedFromWorkspace: string;
  removedFromWorkspaceDescription: string;
  localStatus: string; connectingStatus: string; connectedStatus: string; syncingStatus: string; availableStatus: string; ownerOfflineStatus: string; unavailableStatus: string; history: string; currentVersion: string; initialVersion: string; version: string; collaborationDeleteBlocked: string; collaborationOnlyOne: string; proposalStale: string; joinedPermanentLink: string; proposalPreview: string; parameterResult: string; currentStep: string; rollbackToStep: string; parameterActions: string; language: string; english: string; chinese: string; workspaceVersion: string;
 };

const en: WorkspaceLabels = {
  collaborating: "Collaborating", gallery: "Gallery", imageWorkspace: "Image Workspace",
  chooseImages: "Choose images", operationLog: "Operation log", imagesStayLocal: "Images stay on this device until you explicitly share them.",
  originLibrary: "Origin · Library", chooseOriginal: "Choose an original, then add it to Working", chooseOrDropOriginals: "Choose or drop originals",
  workingProcessing: "Working · Processing", processCollaborate: "Process, doodle, and collaborate on selected images", workingEmpty: "Working is empty", addFromOrigin: "Add an image from Origin to begin processing.",
  collaboration: "Collaboration", collaborators: "Collaborators", noCollaborators: "No collaborators connected", viewingWorkspace: "Viewing workspace", directConnection: "Direct connection", relayedConnection: "Relayed connection", packetLoss: "Packet loss",
  activity: "Activity", messages: "Messages", noMessages: "No messages", workspaceSettings: "Workspace settings", workspaceStyleEditor: "Workspace style editor",
  stylePreview: "Style preview", imageInformation: "Image information", selectImage: "Select an image to inspect it.", workspaceOverview: "Workspace overview",
  imagesTotal: "Images total", inWorking: "In Working", workspaceShare: "Workspace share", createPermanentLink: "Create a permanent link for collaborators. Creating a new link invalidates the previous one.",
  createShareLink: "Create share link", createNewLink: "Create new link", copyShareLink: "Copy share link", shareLinkCopied: "Share link copied", copyWorkspaceId: "Copy Share ID", workspaceIdCopied: "Share ID copied", shareId: "Share ID", enterWorkspace: "Enter Workspace", join: "Join", ownerOffline: "Owner is offline.", loadingWorkspace: "Loading workspace", shareLinkUnavailable: "The share link is invalid or no longer active.", showingCachedWorkspace: "Showing cached workspace data.", noCachedWorkspace: "No cached workspace data is available.",
  workspaceUnavailable: "Workspace unavailable", openMyWorkspace: "Open my workspace", returnHome: "Return home", leaveWorkspace: "Leave workspace", leaveWorkspaceQuestion: "Leave this workspace?",
  leaveWorkspaceDescription: "Leaving disconnects the current collaboration session and returns to the home page.",
  stopCollaborationQuestion: "Stop collaboration?", stopCollaborationDescription: "The current parameter edits remain on this Working image. You can also save the rendered result as a new image before stopping.", stoppingCollaboration: "Stopping...", stopDirectly: "Stop", saveAndStopCollaboration: "Save & stop", saveImageQuestion: "Save current image?", saveImageConfirmationDescription: "Keep the parameter document on this image, or render a parameter-free copy in Working. Collaboration will continue.",
  cancel: "Cancel", close: "Close", confirm: "Confirm", save: "Save", sourceFileSize: "Source file", downloading: "Downloading...", downloadComplete: "Downloaded", accept: "Accept", reject: "Reject", preview: "Preview", approve: "Approve", later: "Later",
  removeCollaborator: "Remove collaborator", removeCollaboratorQuestion: "Remove this collaborator?", removeCollaboratorDescription: "{name} will be disconnected from this workspace.", confirmRemoveCollaborator: "Remove", removedFromWorkspace: "Removed from workspace", removedFromWorkspaceDescription: "The Owner removed you from this workspace. Your collaboration connection has been closed. Return home to continue.",
  imageProcessing: "Image processing", returnToGallery: "Return to gallery", chooseOrDrop: "Choose or drop originals", originImagesOwner: "Origin images stay on the Owner device", pngFormats: "PNG, JPEG, WebP or AVIF", operationLogTitle: "Operation log", chooseImagesDescription: "Images stay on this device until you explicitly share them.", pendingProposals: "Pending proposals", typeMessage: "Type a message", sourceRequest: "Source data request", requestingSource: "Requesting source...", requestSource: "Request source", saveImage: "Save image", deleteImage: "Delete image", confirmRollback: "Confirm rollback", activityPreview: "Activity preview", workspaceStyle: "Workspace style editor", headerText: "Header text", background: "Background", backgroundColor: "Background color", gradientFrom: "Gradient from", gradientTo: "Gradient to", gradientDirection: "Gradient direction", textColor: "Text color", fontFamily: "Font family", fontSize: "Font size", fontWeight: "Font weight", resetStyle: "Reset style", workspaceName: "Workspace name", workspaceId: "Workspace ID", status: "Status", solid: "Solid", gradient: "Gradient", right: "Right", down: "Down", downRight: "Down right", current: "Current", originalImage: "Original image", rollback: "Rollback", retry: "Retry", you: "You", proposalApproved: "Proposal approved", proposalRejected: "Proposal rejected", proposalDeferred: "Proposal deferred", proposalSubmitted: "Proposal submitted", noActivity: "No activity yet", closePreview: "Close", previewQueue: "Preview of the selected parameter queue", rollbackDescription: "The parameter queue will return to this version. Every later Commit will be removed.", collaboratorRollbackDescription: "Only the Owner can roll back Activity history.", sourceRejectReason: "Reject reason (optional)", rejectProposal: "Reject proposal", reason: "Reason", saving: "Saving...", applyHistory: "Apply the collaborative parameter history to image pixels.", replaceOriginal: "Overwrite image", replaceOriginalDescription: "Keep the current parameter document on this image.", saveAsNewImage: "Save as new image", saveAsNewImageDescription: "Create a rendered image without parameters in Working.", workspaceOverviewName: "Workspace overview", totalImages: "Images total", workingCount: "In Working", home: "Home", imageActions: "Image actions", download: "Download", sourceUnavailable: "Source data unavailable", zoomOut: "Zoom out", zoomIn: "Zoom in", preparingPreview: "Preparing preview...", noSelection: "Select an image to inspect it.", created: "Created", source: "Source", library: "Library", working: "Working", currentCommit: "Current Commit", initial: "Initial", startCollaboration: "Start collaboration", stopCollaboration: "Stop collaboration", doodle: "Doodle", color: "Color", crop: "Crop", resize: "Resize", adjust: "Adjust", convert: "Convert", compress: "Compress", saveProcessed: "Save image", saveProcessedDescription: "Choose where to keep the generated image. The source image will not be changed.", saveToLibrary: "Save to Library", saveToWorking: "Save to Working", deletePermanently: "Delete permanently", returnToLibrary: "Return to Library", keepOriginal: "Keep the original on this device.", removeHistory: "Remove the image and its local history.", processPixels: "Apply the collaborative parameter history to image pixels.", guest: "Guest", wantsOriginal: "wants the original data for", thisImage: "this image",
  localStatus: "Local", connectingStatus: "Connecting", connectedStatus: "Connected", syncingStatus: "Syncing", availableStatus: "Available", ownerOfflineStatus: "Owner offline", unavailableStatus: "Unavailable", history: "History", currentVersion: "Current version", initialVersion: "Initial version", version: "Version", collaborationDeleteBlocked: "This image is being collaborated on and cannot be deleted. Stop collaboration first.", collaborationOnlyOne: "Only one image can be collaborated on at a time.", proposalStale: "This image has been updated. Sync the latest version before submitting.", joinedPermanentLink: "Joined with a permanent share link.", proposalPreview: "Proposal preview", parameterResult: "Parameter result", currentStep: "Current step", rollbackToStep: "Rollback to this step?", parameterActions: "parameter actions", language: "Language", english: "English", chinese: "Chinese", workspaceVersion: "Workspace version", brightness: "Brightness", applied: "Applied", historyRolledBack: "History rolled back", imageSaved: "Image saved", commitId: "Commit ID", draft: "Draft", submitted: "Submitted", pendingReview: "Pending review", approvedStatus: "Approved", rejectedStatus: "Rejected", reviewLater: "Review later", sendFailed: "Send failed", versionConflict: "Version conflict", idle: "Idle", owner: "Owner", clearOperationLog: "Clear operation log", noOperationLogs: "No operation logs",
 };

const zh: WorkspaceLabels = {
  stopCollaborationQuestion: "停止图片协作？", stopCollaborationDescription: "当前参数修改会继续保留在这张 Working 图片上，也可以先将渲染结果另存为新图片再停止。", stoppingCollaboration: "正在处理...", stopDirectly: "停止", saveAndStopCollaboration: "保存并停止", saveImageQuestion: "保存当前图片？", saveImageConfirmationDescription: "可将参数保留在当前图片上，或在 Working 中另存一张不含参数的新图片。协作会继续。",
  collaborating: "协作中", gallery: "图片库", imageWorkspace: "图片工作区", chooseImages: "选择图片", operationLog: "操作日志", imagesStayLocal: "图片会保留在当前设备，直到你明确分享。",
  originLibrary: "原始图 · 图片库", chooseOriginal: "选择原图，然后加入处理区", chooseOrDropOriginals: "选择或拖入原图", workingProcessing: "图片处理区", processCollaborate: "处理、涂鸦并协作处理选中的图片",
  workingEmpty: "处理区为空", addFromOrigin: "从原始图区域添加图片开始处理。", collaboration: "协作", collaborators: "协作者", noCollaborators: "暂无在线协作者", viewingWorkspace: "正在查看", directConnection: "设备直连", relayedConnection: "网络转发", packetLoss: "丢包率",
  activity: "动态", messages: "消息", noMessages: "暂无消息", workspaceSettings: "工作区设置", workspaceStyleEditor: "工作区样式编辑器", stylePreview: "样式预览", imageInformation: "图片信息", selectImage: "选择图片后查看详细信息。",
  workspaceOverview: "工作区概览", imagesTotal: "图片总数", inWorking: "Working 中", workspaceShare: "工作区分享", createPermanentLink: "创建供协作者使用的永久链接。创建新链接会使旧链接失效。", createShareLink: "创建分享链接", createNewLink: "创建新链接", copyShareLink: "复制分享链接", shareLinkCopied: "分享链接复制成功", copyWorkspaceId: "复制分享 ID", workspaceIdCopied: "分享 ID 复制成功", shareId: "分享 ID", enterWorkspace: "进入工作区", join: "加入", ownerOffline: "Owner 已离线。", loadingWorkspace: "正在加载工作区", workspaceUnavailable: "工作区不可用", openMyWorkspace: "打开我的工作区", returnHome: "返回首页", shareLinkUnavailable: "分享链接无效或已失效。", showingCachedWorkspace: "正在显示缓存的工作区数据。", noCachedWorkspace: "没有可用的缓存工作区数据。",
  leaveWorkspace: "退出工作区", leaveWorkspaceQuestion: "退出这个工作区？", leaveWorkspaceDescription: "退出后将断开当前协作连接并返回首页。", cancel: "取消", close: "关闭", confirm: "确认", save: "保存", sourceFileSize: "源文件", downloading: "正在下载...", downloadComplete: "下载完成", accept: "接受", reject: "拒绝", preview: "预览", approve: "同意", later: "稍后处理", removeCollaborator: "移除协作者", removeCollaboratorQuestion: "移除这个协作者？", removeCollaboratorDescription: "将断开 {name} 与此工作区的连接。", confirmRemoveCollaborator: "确认移除", removedFromWorkspace: "已被移出工作区", removedFromWorkspaceDescription: "Owner 已将你移出此工作区，当前协作连接已断开。返回首页后可继续使用本地功能。",
  imageProcessing: "图片处理", returnToGallery: "返回图片库", chooseOrDrop: "选择或拖入原图", originImagesOwner: "原始图片保留在 Owner 设备", pngFormats: "PNG、JPEG、WebP 或 AVIF", operationLogTitle: "操作日志", chooseImagesDescription: "图片会保留在当前设备，直到你明确分享。", pendingProposals: "待处理申请", typeMessage: "输入消息", sourceRequest: "原始数据请求", requestingSource: "正在请求原图...", requestSource: "请求原图", saveImage: "保存图片", deleteImage: "删除图片", confirmRollback: "确认回退", activityPreview: "动态预览", workspaceStyle: "工作区样式编辑器", headerText: "头部文字", background: "背景", backgroundColor: "背景颜色", gradientFrom: "渐变起点", gradientTo: "渐变终点", gradientDirection: "渐变方向", textColor: "文字颜色", fontFamily: "字体", fontSize: "字号", fontWeight: "字重", resetStyle: "重置样式", workspaceName: "工作区名称", workspaceId: "工作区 ID", status: "状态", solid: "纯色", gradient: "渐变", right: "向右", down: "向下", downRight: "右下", current: "当前", originalImage: "原始图片", rollback: "回退", retry: "重试", you: "你", proposalApproved: "申请已同意", proposalRejected: "申请已拒绝", proposalDeferred: "申请已延后", proposalSubmitted: "已提交申请", noActivity: "暂无动态", closePreview: "关闭", previewQueue: "选中参数队列的预览", rollbackDescription: "参数队列将回退到此版本，之后的 Commit 会被移除。", collaboratorRollbackDescription: "只有 Owner 可以回退动态历史。", sourceRejectReason: "拒绝理由（可选）", rejectProposal: "拒绝申请", reason: "理由", saving: "保存中...", applyHistory: "将协作参数历史应用到图片像素。", replaceOriginal: "覆盖原图", replaceOriginalDescription: "在当前图片上保留参数文档。", saveAsNewImage: "另存为新图片", saveAsNewImageDescription: "在 Working 中创建一张不含参数的渲染图片。", workspaceOverviewName: "工作区概览", totalImages: "图片总数", workingCount: "Working 中", home: "首页", imageActions: "图片操作", download: "下载", sourceUnavailable: "原始数据不可用", zoomOut: "缩小", zoomIn: "放大", preparingPreview: "正在准备预览...", noSelection: "选择图片后查看详细信息。", created: "创建时间", source: "来源", library: "图片库", working: "Working", currentCommit: "当前 Commit", initial: "初始版本", startCollaboration: "开始协作", stopCollaboration: "停止协作", doodle: "涂鸦", color: "颜色", crop: "裁剪", resize: "调整尺寸", adjust: "调整", convert: "转换", compress: "压缩", saveProcessed: "保存图片", saveProcessedDescription: "选择生成的图片保存位置，源图片不会被修改。", saveToLibrary: "保存到图片库", saveToWorking: "保存到 Working", deletePermanently: "永久删除", returnToLibrary: "移回图片库", keepOriginal: "保留当前设备上的原图。", removeHistory: "移除图片及其本地历史。", processPixels: "将协作参数历史应用到图片像素。", guest: "访客", wantsOriginal: "想要此图片的原始数据", thisImage: "此图片",
  localStatus: "本地", connectingStatus: "连接中", connectedStatus: "已连接", syncingStatus: "同步中", availableStatus: "可用", ownerOfflineStatus: "Owner 已离线", unavailableStatus: "不可用", history: "历史", currentVersion: "当前版本", initialVersion: "初始版本", version: "版本", collaborationDeleteBlocked: "当前图片正在协作中，无法删除。请先停止协作。", collaborationOnlyOne: "同一时间只能有一张图片处于协作状态。", proposalStale: "当前图片已更新，请先同步最新版本后再提交。", joinedPermanentLink: "已通过永久分享链接加入。", proposalPreview: "申请预览", parameterResult: "参数结果", currentStep: "当前步骤", rollbackToStep: "回退到此步骤？", parameterActions: "个参数操作", language: "语言", english: "English", chinese: "中文", workspaceVersion: "工作区版本", brightness: "亮度", applied: "已应用", historyRolledBack: "已回退历史", imageSaved: "图片已保存", commitId: "提交 ID", draft: "草稿", submitted: "已提交", pendingReview: "等待审核", approvedStatus: "已同意", rejectedStatus: "已拒绝", reviewLater: "稍后审核", sendFailed: "发送失败", versionConflict: "版本冲突", idle: "空闲", owner: "所有者", clearOperationLog: "清空操作日志", noOperationLogs: "暂无操作日志",
};

export function getWorkspaceLabels(lang: Lang): WorkspaceLabels {
  return lang === "zh"
    ? { ...zh, currentCommit: "当前提交", inWorking: "处理中", working: "处理区", workingCount: "处理中" }
    : en;
}
