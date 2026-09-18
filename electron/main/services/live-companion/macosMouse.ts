// Swift handles AXValue's CGPoint/CGSize memory layout and posts native mouse events.
export const MACOS_MOUSE_SCRIPT = String.raw`
import AppKit
import ApplicationServices

func fail(_ message: String) -> Never {
  FileHandle.standardError.write(Data(message.utf8))
  exit(1)
}
func attribute(_ element: AXUIElement, _ name: String) -> CFTypeRef? {
  var value: CFTypeRef?
  let error = AXUIElementCopyAttributeValue(element, name as CFString, &value)
  return error == .success ? value : nil
}
func text(_ element: AXUIElement, _ name: String) -> String {
  return (attribute(element, name) as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
}
func elements(_ root: AXUIElement) -> [AXUIElement] {
  var queue = [root]
  var index = 0
  while index < queue.count && queue.count < 5000 {
    queue.append(contentsOf: attribute(queue[index], kAXChildrenAttribute) as? [AXUIElement] ?? [])
    index += 1
  }
  return queue
}
guard AXIsProcessTrusted() else { fail("not authorized for accessibility (-25211)") }
let action = CommandLine.arguments.last!
let labels = ["start": "开始直播", "stop": "关播", "confirm-stop": "关闭直播"]
guard let label = labels[action] else { fail("未知点击操作：" + action) }
let pids = CommandLine.arguments[CommandLine.arguments.count - 2].split(separator: ",").compactMap { Int32($0) }
var target: AXUIElement?
var targetPID: pid_t = 0
for pid in pids {
  let app = AXUIElementCreateApplication(pid)
  if let windows = attribute(app, kAXWindowsAttribute) as? [AXUIElement], let window = windows.first {
    target = window
    targetPID = pid
    break
  }
}
guard let window = target else { fail("未找到直播伴侣窗口") }
NSRunningApplication(processIdentifier: targetPID)?.activate(options: [])
AXUIElementPerformAction(window, kAXRaiseAction as CFString)
Thread.sleep(forTimeInterval: 0.35)
var found: AXUIElement?
for attempt in 0..<11 {
  let buttons = elements(window).filter { text($0, kAXRoleAttribute) == kAXButtonRole }
  func named(_ element: AXUIElement, _ names: [String]) -> Bool {
    return [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].contains {
      let value = text(element, $0)
      return names.contains(value) || (names.contains("关播") && value.range(of: #"^(?:\d+:\d{2}(?::\d{2})?\s*)?关播$"#, options: .regularExpression) != nil)
    }
  }
  if action == "start" && buttons.contains(where: { named($0, ["关播", "关闭直播"]) }) { fail("直播伴侣已在直播或关播确认中，已停止开播操作") }
  let matches = buttons.filter { named($0, [label]) }
  if matches.count > 1 { fail("找到多个\(label)按钮，已停止操作") }
  if let button = matches.first { found = button; break }
  if attempt < 10 { Thread.sleep(forTimeInterval: 0.5) }
}
guard let button = found else { fail("等待后仍无法识别\(label)按钮") }
guard attribute(button, kAXEnabledAttribute) as? Bool == true else { fail("\(label)按钮不可用") }
guard let position = attribute(button, kAXPositionAttribute), CFGetTypeID(position) == AXValueGetTypeID(),
      let size = attribute(button, kAXSizeAttribute), CFGetTypeID(size) == AXValueGetTypeID() else { fail("无法读取\(label)按钮坐标") }
var origin = CGPoint.zero
var dimensions = CGSize.zero
guard AXValueGetValue(position as! AXValue, .cgPoint, &origin),
      AXValueGetValue(size as! AXValue, .cgSize, &dimensions),
      dimensions.width > 0, dimensions.height > 0 else { fail("\(label)按钮尺寸无效") }
let center = CGPoint(x: origin.x + dimensions.width / 2, y: origin.y + dimensions.height / 2)
guard center.x.isFinite && center.y.isFinite else { fail("\(label)按钮坐标无效") }
var hit: AXUIElement?
guard AXUIElementCopyElementAtPosition(AXUIElementCreateSystemWide(), Float(center.x), Float(center.y), &hit) == .success,
      let hitElement = hit else { fail("无法确认\(label)按钮是否被遮挡") }
var current: AXUIElement? = hitElement
var matchesTarget = false
for _ in 0..<30 {
  guard let element = current else { break }
  if CFEqual(element, button) { matchesTarget = true; break }
  current = attribute(element, kAXParentAttribute) as! AXUIElement?
}
guard matchesTarget else { fail("\(label)按钮被遮挡或位置发生变化，已停止点击") }
guard let source = CGEventSource(stateID: .hidSystemState),
      let down = CGEvent(mouseEventSource: source, mouseType: .leftMouseDown, mouseCursorPosition: center, mouseButton: .left),
      let up = CGEvent(mouseEventSource: source, mouseType: .leftMouseUp, mouseCursorPosition: center, mouseButton: .left) else { fail("无法创建鼠标点击事件") }
down.setIntegerValueField(.mouseEventClickState, value: 1)
up.setIntegerValueField(.mouseEventClickState, value: 1)
down.post(tap: .cghidEventTap)
Thread.sleep(forTimeInterval: 0.08)
up.post(tap: .cghidEventTap)
let result: [String: Any] = ["method": "nativeMouse", "action": action, "pid": targetPID,
  "names": [kAXTitleAttribute, kAXDescriptionAttribute, kAXValueAttribute].map { text(button, $0) }.filter { !$0.isEmpty },
  "x": center.x, "y": center.y, "eventsPosted": true]
let data = try JSONSerialization.data(withJSONObject: result, options: [.sortedKeys])
print(String(data: data, encoding: .utf8)!)
`
