import type { Menu, MenuItem } from "obsidian";

/**
 * A submenu row: `MenuItem.setSubmenu` (Obsidian 1.x, desktop and mobile) is
 * not in the public typings, so it is probed; where it is missing the group
 * becomes a label followed by its items in the same menu. Shared by the
 * pane's context menu and by the group the plugin adds to a note's editor
 * menu, so the two are built the same way.
 */
export function addSubmenu(menu: Menu, title: string, icon: string, fill: (target: Menu) => void): void {
  let sub: Menu | null = null;
  menu.addItem((item) => {
    item.setTitle(title).setIcon(icon);
    const make = (item as MenuItem & { setSubmenu?: () => Menu }).setSubmenu;
    if (typeof make === "function") sub = make.call(item);
    else item.setIsLabel(true);
  });
  fill(sub ?? menu);
}
