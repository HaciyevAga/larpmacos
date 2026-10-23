// Menu bar contents per app. One string per item:
//   "Title\tShortcut"  plain item ("\t" and shortcut optional)
//   "~Title"           disabled      "✓Title"  checked      "Title ▸"  has submenu
//   "---"              separator
// Photo Booth titles and shortcuts come from Base.lproj/MainMenu.nib (REA ev_a99d3035…); the order inside
// each menu and which items are disabled at idle are inferred. Finder and System Settings are written
// from Sequoia (inferred, not extracted).

const editTail = ['---', 'AutoFill ▸', 'Start Dictation…', 'Emoji & Symbols'];
const windowMenu = (app) => ['~Minimize\t⌘M', '~Zoom', '---', '~Fill', '~Center', '---', '~Move & Resize ▸', '~Full Screen Tile ▸', '---', 'Bring All to Front', ...(app ? ['---', '✓' + app] : [])];

export const MENUS = {
  finder: [
    ['Finder', ['About Finder', '---', 'Settings…\t⌘,', '---', '~Empty Trash…\t⇧⌘⌫', '---', 'Services ▸', '---', 'Hide Finder\t⌘H', 'Hide Others\t⌥⌘H', '~Show All']],
    ['File', ['New Finder Window\t⌘N', 'New Folder\t⇧⌘N', '~New Folder with Selection\t⌃⌘N', 'New Smart Folder', '~New Tab\t⌘T', '~Open\t⌘O', '~Open With ▸', '~Close Window\t⌘W', '---', '~Get Info\t⌘I', '~Rename', '---', '~Compress', '~Duplicate\t⌘D', '~Make Alias\t⌃⌘A', '~Quick Look\t⌘Y', '~Print\t⌘P', '---', '~Share…', '---', '~Show Original\t⌘R', '~Add to Dock\t⌃⇧⌘T', '---', '~Move to Trash\t⌘⌫', '~Eject\t⌘E', '---', 'Tags…', '---', 'Find\t⌘F']],
    ['Edit', ['~Undo\t⌘Z', '~Redo\t⇧⌘Z', '---', '~Cut\t⌘X', '~Copy\t⌘C', '~Paste\t⌘V', 'Select All\t⌘A', '---', 'Show Clipboard', ...editTail]],
    ['View', ['✓as Icons\t⌘1', '~as List\t⌘2', '~as Columns\t⌘3', '~as Gallery\t⌘4', '---', 'Use Stacks\t⌃⌘0', 'Sort By ▸', 'Clean Up', 'Clean Up By ▸', '---', '~Show Tab Bar\t⇧⌘T', '~Show All Tabs\t⇧⌘\\', '---', '~Show Path Bar\t⌥⌘P', '~Show Status Bar\t⌘/', '---', 'Show View Options\t⌘J', '---', '~Enter Full Screen\t⌃⌘F']],
    ['Go', ['~Back\t⌘[', '~Forward\t⌘]', 'Enclosing Folder\t⌘↑', '---', 'Recents\t⇧⌘F', 'Documents\t⇧⌘O', 'Desktop\t⇧⌘D', 'Downloads\t⌥⌘L', 'Home\t⇧⌘H', 'Computer\t⇧⌘C', 'AirDrop\t⇧⌘R', 'Network\t⇧⌘K', 'iCloud Drive\t⇧⌘I', 'Shared\t⇧⌘S', 'Applications\t⇧⌘A', 'Utilities\t⇧⌘U', '---', 'Recent Folders ▸', '---', 'Go to Folder…\t⇧⌘G', 'Connect to Server…\t⌘K']],
    ['Window', windowMenu()],
    ['Help', ['macOS Help', 'Tips for Your Mac', 'See What’s New in macOS']],
  ],
  photobooth: [
    ['Photo Booth', ['About Photo Booth', '---', 'Hide Photo Booth\t⌘H', 'Hide Others\t⌥⌘H', 'Show All', '---', 'Quit Photo Booth\t⌘Q']],
    ['File', ['Take Photo\t⌘↩', '---', '~Export…', '~Export Original…', '---', '~Print…\t⌘P']],
    ['Edit', ['~Undo\t⌘Z', '~Redo\t⇧⌘Z', '---', '~Cut\t⌘X', '~Copy\t⌘C', '~Paste\t⌘V', '~Delete\t⌘⌫', '~Select All\t⌘A', '---', 'Auto Flip New Items', '~Flip Photo\t⌘F', '~Trim Movie…\t⌘T', '~Delete All…', ...editTail]],
    ['View', ['~Show Photo\t⌘1', 'Show Effects\t⌘2', '~Show Last Effect\t⌘3', '---', '~Next Page of Effects\t⌘→', '~Previous Page of Effects\t⌘←', 'Reset Effect\t⇧⌘R', '---', '~Start Slideshow', '---', 'Enter Full Screen\t⌃⌘F']],
    ['Camera', ['✓FaceTime HD Camera']],
    ['Window', ['Close\t⌘W', ...windowMenu('Photo Booth')]],
    ['Help', ['Photo Booth Help\t⌘?']],
  ],
  settings: [
    ['System Settings', ['About System Settings', '---', 'Services ▸', '---', 'Hide System Settings\t⌘H', 'Hide Others\t⌥⌘H', 'Show All', '---', 'Quit System Settings\t⌘Q']],
    ['Edit', ['~Undo\t⌘Z', '~Redo\t⇧⌘Z', '---', '~Cut\t⌘X', '~Copy\t⌘C', '~Paste\t⌘V', '~Select All\t⌘A', ...editTail]],
    ['View', ['~Back\t⌘[', '~Forward\t⌘]', '---', 'Search\t⌘F']],
    ['Window', ['Close\t⌘W', ...windowMenu('Wallpaper')]],
    ['Help', ['System Settings Help']],
  ],
};

export function parseItem(s) {
  if (s === '---') return { sep: true };
  let [title, key = ''] = s.split('\t');
  const disabled = title.startsWith('~'); if (disabled) title = title.slice(1);
  const checked = title.startsWith('✓'); if (checked) title = title.slice(1);
  const sub = title.endsWith(' ▸'); if (sub) title = title.slice(0, -2);
  return { title, key, disabled, checked, sub };
}
