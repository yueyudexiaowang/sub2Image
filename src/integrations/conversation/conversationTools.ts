import { SUB2_CANVAS_TOOL_ID, sub2CanvasTool } from './sub2CanvasTool'
import { SUB2_CHAT_TOOL_ID, sub2ImageChatTool } from './sub2ImageChatTool'
import { SUB2_IMAGE_TOOL_ID, sub2ImageImageTool } from './sub2ImageImageTool'
import { SUB2_VIDEO_TOOL_ID, sub2VideoTool } from './sub2VideoTool'

export const conversationTools = [sub2ImageImageTool, sub2VideoTool, sub2ImageChatTool, sub2CanvasTool]

export { SUB2_CANVAS_TOOL_ID, SUB2_CHAT_TOOL_ID, SUB2_IMAGE_TOOL_ID, SUB2_VIDEO_TOOL_ID }
