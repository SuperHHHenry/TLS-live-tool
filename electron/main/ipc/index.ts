import { setupAIChatIpcHandlers } from './aichat'
import { setupAppIpcHandlers } from './app'
import { setupAutoLuckyBagIpcHandlers } from './autoLuckyBag'
import { setupAutoMessageIpcHandlers } from './autoMessage'
import { setupAutoPopUpIpcHandlers } from './autoPopUp'
import { setupBrowserIpcHandlers } from './browser'
import { setupAutoReplyIpcHandlers } from './commentListener'
import { setupLiveControlIpcHandlers } from './connection'
import { setupPinCommentIpcHandler } from './pinComment'
import { setupRedPacketIpcHandlers } from './redPacket'
import { setupUpdateIpcHandlers } from './update'
import { setupViewerIpcHandlers } from './viewer'

setupLiveControlIpcHandlers()
setupAIChatIpcHandlers()
setupAutoPopUpIpcHandlers()
setupAutoLuckyBagIpcHandlers()
setupAutoReplyIpcHandlers()
setupAutoMessageIpcHandlers()
setupBrowserIpcHandlers()
setupAppIpcHandlers()
setupUpdateIpcHandlers()
setupPinCommentIpcHandler()
setupRedPacketIpcHandlers()
setupViewerIpcHandlers()
