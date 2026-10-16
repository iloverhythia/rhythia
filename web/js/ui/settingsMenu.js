// Port of scripts/ui/SettingsMenu.cs (main.tscn/Settings)

import { SectionNames } from '../settings.js';
import { Ease, Trans, tween } from '../util.js';
import { button, el } from './common.js';

export class SettingsMenu {
    constructor(app) {
        this.app = app;
        this.sm = app.settingsManager;
        this.root = el('div', 'settings hidden', document.body);
        const hide = el('button', 'hide', this.root);
        hide.addEventListener('mousedown', () => this.hideMenu());
        hide.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            this.hideMenu();
        });

        this.holder = el('div', 'holder', this.root);
        this.sidebar = el('div', 'sidebar scroll', this.holder);
        this.categories = el('div', 'categories', this.holder);

        const header = el('div', 'header', this.holder);
        el('div', 'title', header, 'SETTINGS');
        this.profiles = el('select', 'option profiles', header);
        this.profiles.addEventListener('change', () => this.selectProfile(this.profiles.value));
        const create = el('button', 'create', header);
        create.title = 'Create Profile';
        this.profileEdit = el('input', 'line-edit profile-edit hidden', header);
        this.profileEdit.placeholder = 'profile name';
        create.addEventListener('click', () => {
            this.profileEdit.classList.toggle('hidden');
            if (!this.profileEdit.classList.contains('hidden')) this.profileEdit.focus();
        });
        this.profileEdit.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && this.profileEdit.value.trim()) {
                const name = this.profileEdit.value.trim().replace(/[^\w\- ]/g, '');
                this.profileEdit.value = '';
                this.profileEdit.classList.add('hidden');
                this.sm.save();
                this.sm.saveJson(name, this.sm.settings.serialize());
                this.sm.setCurrentProfile(name);
                this.sm.load(name);
                this.updateProfileSelection();
            } else if (e.key === 'Escape') {
                this.profileEdit.classList.add('hidden');
            }
        });

        this.outline = el('div', 'outline', this.holder);

        this.sectionEls = new Map();
        this.rows = new Map();
        this.build();
        this.updateProfileSelection();
        this.sm.on('loaded', () => this.refreshAll());
    }

    build() {
        this.sidebar.innerHTML = '';
        this.categories.innerHTML = '';
        this.sectionEls.clear();
        this.rows.clear();

        const sections = this.sm.settings.toOrderedSectionList();
        let first = true;
        for (const [section, items] of sections) {
            if (section === 0) continue;
            const row = el('div', 'row', this.sidebar);
            const b = el('button', '', row, SectionNames[section].toUpperCase());
            const category = el('div', 'category scroll hidden', this.categories);
            b.addEventListener('click', () => this.selectSection(section));
            this.sectionEls.set(section, { row, category });

            for (const item of items) {
                if (!item.visible) continue;
                this.buildRow(category, item);
            }

            if (first) {
                this.selectSection(section);
                first = false;
            }
        }
    }

    selectSection(section) {
        for (const [s, { row, category }] of this.sectionEls) {
            row.classList.toggle('selected', s === section);
            category.classList.toggle('hidden', s !== section);
        }
    }

    buildRow(parent, item) {
        const row = el('div', 'item', parent);
        const title = el('div', 'title', row, '');
        title.textContent = item.title;
        title.title = item.description;
        const refresh = [];

        if (item.type === 'bool') {
            const check = el('input', 'check', row);
            check.type = 'checkbox';
            check.addEventListener('change', () => (item.value = check.checked));
            refresh.push(() => (check.checked = item.value));
        } else if (item.slider) {
            const { step, min, max } = item.slider;
            const slider = el('input', 'slider', row);
            slider.type = 'range';
            slider.min = min;
            slider.max = max;
            slider.step = step;
            const edit = el('input', 'line-edit flat value', row);
            edit.maxLength = 5;
            edit.placeholder = Number(item.defaultValue).toFixed(4);
            const updateFill = () => slider.style.setProperty('--fillk', (Number(slider.value) - min) / (max - min));
            slider.addEventListener('input', () => {
                item.value = Number(slider.value);
                edit.value = String(Math.round(item.value * 1000) / 1000);
                updateFill();
            });
            const apply = () => {
                const v = parseFloat(edit.value);
                if (!Number.isNaN(v)) item.value = v;
                refreshFn();
            };
            edit.addEventListener('change', apply);
            edit.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') edit.blur();
            });
            const refreshFn = () => {
                slider.value = item.value;
                edit.value = String(Math.round(item.value * 1000) / 1000);
                updateFill();
            };
            refresh.push(refreshFn);
        } else if (item.list) {
            const select = el('select', 'option', row);
            select.addEventListener('change', () => (item.value = select.value));
            refresh.push(() => {
                select.innerHTML = '';
                for (const v of item.list.values) {
                    const o = el('option', '', select);
                    o.value = v;
                    o.textContent = v;
                }
                select.value = item.value;
            });
        } else if (item.type === 'string') {
            const edit = el('input', 'line-edit flat text', row);
            edit.placeholder = item.placeholder || 'input';
            edit.disabled = !item.editable;
            edit.addEventListener('change', () => (item.value = edit.value));
            edit.addEventListener('keydown', (e) => e.stopPropagation());
            refresh.push(() => (edit.value = item.value));
        } else if (item.buttons.length) {
            const holder = el('div', 'buttons', row);
            for (const b of item.buttons) {
                let last = 0;
                const btn = button(b.title, 'btn white', holder, () => {
                    if (performance.now() - last < 250) return;
                    last = performance.now();
                    b.onPressed();
                });
                btn.title = b.description;
            }
        }

        this.rows.set(item, refresh);
        refresh.forEach((f) => f());
    }

    refreshList(item) {
        this.rows.get(item)?.forEach((f) => f());
    }

    refreshAll() {
        for (const fns of this.rows.values()) fns.forEach((f) => f());
        this.updateProfileSelection();
    }

    updateProfileSelection() {
        const current = this.sm.getCurrentProfile();
        this.profiles.innerHTML = '';
        for (const name of this.sm.getProfiles()) {
            const o = el('option', '', this.profiles);
            o.value = name;
            o.textContent = name;
        }
        this.profiles.value = current;
    }

    selectProfile(name) {
        this.sm.save();
        this.sm.setCurrentProfile(name);
        this.sm.load(name);
        this.updateProfileSelection();
    }

    showMenu(show = true) {
        this.sm.shown = show;
        this.tweens?.forEach((t) => t.kill());
        if (show) {
            this.refreshAll();
            this.root.classList.remove('hidden');
            this.app.menuCursor.updateVisible(this.sm.settings.UseCursorInMenus.value);
        } else {
            this.sm.save();
        }
        const from = Number(this.root.style.opacity || 0);
        const fromOffset = show ? 25 : 0;
        this.tweens = [
            tween((a) => (this.root.style.opacity = a), from, show ? 1 : 0, 0.25, {
                trans: Trans.QUAD,
                ease: Ease.OUT,
                onDone: () => {
                    if (!this.sm.shown) this.root.classList.add('hidden');
                },
            }),
            tween((o) => (this.holder.style.transform = `translateY(${o}px)`), fromOffset, show ? 0 : 25, 0.25, { trans: Trans.QUAD, ease: Ease.OUT }),
        ];
        this.app.onSettingsShown?.(show);
    }

    hideMenu() {
        if (this.sm.shown) this.showMenu(false);
    }

    toggle() {
        this.showMenu(!this.sm.shown);
    }
}
