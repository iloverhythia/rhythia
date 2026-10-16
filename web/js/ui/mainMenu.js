// Port of scripts/scenes/MainMenu.cs and scenes/main_menu.tscn (+ SortMenuButton.cs, SearchPanel.cs, RandomPickButton.cs,
// QuitButton.cs, StatsPanel.cs, ExtrasPanel)

import { Ease, Trans, escapeHtml, pickFiles, tween } from '../util.js';
import { OptionPopup, button, el, linkPopupButton } from './common.js';
import { GameScene } from '../game/game.js';
import { JukeboxPanel } from './jukebox.js';
import { MapInfo } from './mapInfo.js';
import { MapList, outlineBackground } from './mapList.js';

const VERSION = '0.2.0';

export function topBar(parent, app, { version = true, results = false } = {}) {
    const bar = el('div', 'topbar theme', parent);
    el('div', 'background blur', bar);
    const logo = el('img', 'logo', bar);
    logo.src = '../textures/RhythiaSquircle.png';
    el('div', 'version', bar, version ? `Rhythia <small>${VERSION}</small>` : 'Rhythia');
    if (results) el('div', 'results-label', bar, 'RESULTS');
    return bar;
}

export class MainMenu {
    constructor(app) {
        this.app = app;
        this.name = 'SceneMenu';
        this.useMenuSpace = true;
        this.element = el('div', 'scene scene-menu');
        this.build();
    }

    build() {
        const app = this.app;
        const root = this.element;
        this.menusEl = el('div', 'menus', root);

        // ---- Home
        this.home = el('div', 'menu home', this.menusEl);
        const buttons = el('div', 'home-buttons', this.home);
        el('button', 'home-button big', buttons, 'PLAY').addEventListener('click', () => this.transition('play'));
        el('button', 'home-button big', buttons, 'SETTINGS').addEventListener('click', () => app.settingsMenu.showMenu());
        el('button', 'home-button small', buttons, 'EXTRAS').addEventListener('click', () => this.transition('extras'));
        linkPopupButton(el('button', 'home-button small', buttons, 'RELEASE NOTES'), `https://github.com/Rhythia/Client/releases/tag/${VERSION}`);
        el('button', 'home-button small', buttons, 'QUIT').addEventListener('click', () => this.showQuit());

        // ---- Play
        this.play = el('div', 'menu play hidden', this.menusEl);
        this.play.style.opacity = 0;
        el('div', 'menu-background', this.play);
        this.mapInfo = new MapInfo(this.play, app);
        this.mapList = new MapList(this.play, app);
        this.buildToolbar();
        this.mapInfo.on('play', () => app.playSelected());
        this.mapList.on('play', () => app.playSelected());
        this.mapList.on('select', (map) => app.selectMap(map));
        this.mapList.on('focus', () => this.transition('play'));

        // ---- Extras
        this.extras = el('div', 'menu extras hidden', this.menusEl);
        this.extras.style.opacity = 0;
        el('div', 'menu-background', this.extras);
        this.buildExtras();

        // ---- TopBar
        const bar = topBar(root, app);
        const menuButtons = el('div', 'menu-buttons', bar);
        this.menuButtons = {
            home: button('Home', 'btn flat', menuButtons, () => this.transition('home')),
            play: button('Play', 'btn flat', menuButtons, () => this.transition('play')),
            extras: button('Extras', 'btn flat', menuButtons, () => this.transition('extras')),
        };
        this.menuButtons.home.disabled = true;
        const links = el('div', 'link-buttons', bar);
        linkPopupButton(el('button', 'github', links), 'https://github.com/Rhythia');
        linkPopupButton(el('button', 'discord', links), 'https://discord.gg/kaFPWkfZeS');

        // ---- Jukebox
        this.jukebox = new JukeboxPanel(root, app);

        this.menus = { home: this.home, play: this.play, extras: this.extras };
        this.current = 'home';
        this.last = 'home';
        this.quitPopup = new OptionPopup('Quit', 'Are you sure?');
        this.quitPopup.addOption('Quit', () => app.quit());
        this.quitPopup.addOption('Cancel', () => {});
    }

    buildToolbar() {
        const app = this.app;
        const sm = app.skinManager;
        const bar = el('div', 'sub-topbar theme', this.play);
        const row = el('div', 'row', bar);

        const settings = button('Settings', 'btn white', row, () => app.settingsMenu.showMenu(), sm.url('settingsButtonImage'));
        settings.title = 'CTRL + O';
        button('User Folder', 'btn white', row, () => app.exportUserData(), sm.url('openFolderButtonImage')).title = 'Download a backup of your browser user folder';
        button('Import', 'btn white', row, () => this.importMaps(), sm.url('importButtonImage'));
        button('Random', 'btn white', row, () => this.mapList.pickRandom(), sm.url('randomButtonImage'));
        el('div', 'separator', row);

        this.layoutBtn = button('', 'btn icon', row, () => {
            this.mapList.setLayout(this.mapList.layout === 'list' ? 'grid' : 'list');
            this.updateLayoutIcon();
        }, sm.url('layoutListButtonImage'));
        const filters = button('', 'btn icon', row, null, sm.url('filterButtonImage'));
        filters.disabled = true;

        // Sort toggle + dropdown
        const sortWrap = el('div', '', row);
        sortWrap.style.position = 'relative';
        this.sortBtn = button('', 'btn icon', sortWrap, () => this.toggleSort(), sm.url('sortAscendButtonImage'));
        this.sortPanel = el('div', 'sort-dropdown hidden', sortWrap);
        el('div', 'bg', this.sortPanel);
        const orderRow = el('div', 'order-row', this.sortPanel);
        this.orderBtn = button('', 'btn', orderRow, () => {
            this.mapList.ascending = !this.mapList.ascending;
            this.updateSortIcons();
            this.mapList.updateMaps();
        }, sm.url('sortAscendButtonImage'));
        this.orderLabel = el('span', '', orderRow, 'Ascending');
        const types = el('div', 'types', this.sortPanel);
        this.sortTypeButtons = {};
        for (const [type, label] of [
            ['Alphabetical', 'Alphabetical\n'],
            ['Difficulty', 'Difficulty\n'],
            ['Mappers', 'Mappers'],
        ]) {
            const b = button(label, 'btn white', types, () => {
                this.mapList.sorting = type;
                this.updateSortIcons();
                this.mapList.updateMaps();
            });
            this.sortTypeButtons[type] = b;
        }
        this.updateSortIcons();
        document.addEventListener('mousedown', (e) => {
            if (this.sortOpen && !this.sortPanel.contains(e.target) && !this.sortBtn.contains(e.target)) this.toggleSort(false);
        });

        // Search fields
        const searchField = (width, placeholder, iconKey, onChange) => {
            const panel = el('div', 'search-panel', row);
            panel.style.width = `${width}px`;
            const icon = el('img', 'icon', panel);
            icon.src = sm.url(iconKey);
            const input = el('input', 'line-edit', panel);
            input.placeholder = placeholder;
            input.addEventListener('input', () => {
                panel.classList.toggle('filled', input.value !== '');
                onChange(input.value);
            });
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Escape') input.blur();
            });
            return input;
        };
        this.authorInput = searchField(150, 'Author', 'authorButtonImage', (v) => {
            this.mapList.author = v;
            this.mapList.updateMaps();
        });
        this.searchInput = searchField(220, 'Search', 'searchButtonImage', (v) => {
            this.mapList.search = v;
            this.mapList.updateMaps();
        });
        document.addEventListener('mousedown', (e) => {
            if (e.target !== this.searchInput && e.target !== this.authorInput) {
                this.searchInput.blur();
                this.authorInput.blur();
            }
        });
    }

    updateLayoutIcon() {
        const key = this.mapList.layout === 'list' ? 'layoutListButtonImage' : 'layoutGridButtonImage';
        this.layoutBtn.querySelector('img').src = this.app.skinManager.url(key);
    }

    updateSortIcons() {
        const key = this.mapList.ascending ? 'sortAscendButtonImage' : 'sortButtonImage';
        const url = this.app.skinManager.url(key);
        this.sortBtn.querySelector('img').src = url;
        this.orderBtn.querySelector('img').src = url;
        this.orderLabel.textContent = this.mapList.ascending ? 'Ascending' : 'Descending';
        for (const [type, b] of Object.entries(this.sortTypeButtons)) b.disabled = type === this.mapList.sorting;
    }

    toggleSort(open = !this.sortOpen) {
        this.sortOpen = open;
        this.sortBtn.classList.toggle('pressed', open);
        this.sortPanel.classList.toggle('hidden', !open);
    }

    async importMaps() {
        const files = await pickFiles({ accept: '.sspm,.phxm,.txt,.rhm,.mp3,.ogg', multiple: true });
        if (files.length) await this.app.importFiles(files);
    }

    buildExtras() {
        const app = this.app;
        const ss = el('button', 'extras-sound-space', this.extras);
        const img = el('img', '', ss);
        img.src = '../textures/RhythiaSquircle.png';
        el('div', 'label', ss, 'Inspired by <b>Sound Space</b>');
        linkPopupButton(ss, 'https://www.roblox.com/games/2677609345/Sound-Space');

        // Stats
        const stats = el('div', 'extras-panel', this.extras);
        stats.style.right = 'calc(50% + 150px)';
        el('div', 'bg', stats);
        this.statsOutline = el('div', 'outline', stats);
        el('div', 'header', stats, 'STATISTICS');
        this.statsContent = el('div', 'content scroll', stats);

        // Contributors
        const credits = el('div', 'extras-panel', this.extras);
        credits.style.left = 'calc(50% + 150px)';
        el('div', 'bg', credits);
        this.creditsOutline = el('div', 'outline', credits);
        el('div', 'header', credits, 'CONTRIBUTORS');
        const content = el('div', 'content scroll', credits);
        const list = el('div', 'contributors', content);
        const people = [
            ['nyuwaea', '#d0bdff'],
            ['fog', '#bd76f7'],
            ['nyarw', '#43fff3'],
            ['lulusuki', '#ffbdff'],
            ['noobour', '#0f81b7'],
            ['cake', '#7ef1c6'],
            ['allusionist', '#fab7a3'],
            ['kiwie', '#ffd088'],
            ['snuz', '#98fb98'],
        ];
        for (const [name, color] of people) {
            const d = el('div', '', list);
            d.textContent = name;
            d.style.color = color;
        }
        const jonvy = el('div', '', list, '<a>jonvy</a><span class="sub">"Redshift" (Menu theme) artist</span>');
        jonvy.style.color = '#f59bad';
        linkPopupButton(jonvy, 'https://soundcloud.com/jonvyost');

        app.stats.on('updated', () => this.updateStats());
        this.updateStats();
    }

    updateStats() {
        const s = this.app.stats;
        const favourite = [...this.app.mapManager.maps].sort((a, b) => b.playCount - a.playCount)[0];
        const rows = [
            ['Game Playtime', `${Math.floor(s.GamePlaytime / 3600)}h`, 'Time spent strictly being in a map'],
            ['Total Playtime', `${Math.floor(s.TotalPlaytime / 3600)}h`],
            ['Games Opened', s.GamesOpened],
            ['Total Distance', `${Math.floor(s.TotalDistance / 1000)}m`, 'Adjusted to 1000 DPI'],
            ['Notes Hit', s.NotesHit],
            ['Notes Missed', s.NotesMissed],
            ['Highest Combo', s.HighestCombo],
            ['Attempts', s.Attempts],
            ['Passes', s.Passes],
            ['Full Combos', s.FullCombos],
            ['Highest Score', s.HighestScore],
            ['Total Score', s.TotalScore],
            ['Average Accuracy', Number(s.AverageAccuracy).toFixed(2)],
            ['Rage Quits', s.RageQuits],
        ];
        let html = rows
            .map(([k, v, tip]) => `<div class="stats-row"${tip ? ` title="${escapeHtml(tip)}"` : ''}><div class="key">${k}</div><div class="value">${escapeHtml(v)}</div></div>`)
            .join('');
        html += `<div class="stats-row top"><div class="key">Favourite Map</div><div class="value">${favourite && favourite.playCount > 0 ? escapeHtml(favourite.title) : ''}</div></div>`;
        this.statsContent.innerHTML = html;
    }

    showQuit() {
        this.quitPopup.show();
    }

    // MainMenu.Transition
    transition(name, instant = false) {
        if (this.current === name) return;
        this.last = this.current;
        this.current = name;
        this.menuButtons[this.last].disabled = false;
        this.menuButtons[this.current].disabled = true;

        const out = this.menus[this.last];
        const inn = this.menus[this.current];
        const t = instant ? 0 : 0.15;
        out._tween?.kill();
        inn._tween?.kill();
        out._tween = tween((a) => (out.style.opacity = a), Number(out.style.opacity || 1), 0, t, {
            trans: Trans.QUAD,
            ease: Ease.IN,
            onDone: () => out.classList.add('hidden'),
        });
        inn.classList.remove('hidden');
        inn._tween = tween((a) => (inn.style.opacity = a), Number(inn.style.opacity || 0), 1, t, { trans: Trans.QUAD });

        this.app.sound.refreshMenuMusicPlayback();
    }

    async load() {
        const app = this.app;
        await GameScene.attempt?.scorePromise;
        document.body.classList.remove('hide-cursor');
        app.menuCursor.updateVisible(app.settingsManager.settings.UseCursorInMenus.value);
        this.mapList.updateMaps();
        const selected = app.mapManager.selected.value;
        if (selected) {
            this.mapInfo.refresh();
            this.mapList.select(selected, false);
            app.sceneManager.space?.updateMap(selected, null);
            app.mapManager.getCoverUrl(selected).then((url) => app.sceneManager.space?.updateMap(selected, url));
        }
        this.updateStats();
        app.sound.refreshMenuMusicPlayback();
        if (app.settingsManager.settings.AutoplayJukebox.value && !app.sound.song.playing && app.sound.map != null) {
            app.sound.playJukebox(app.sound.jukeboxIndex);
        }
    }

    unload() {}

    // ---------------------------------------------------------------- input

    onKeyDown(e) {
        const focused = document.activeElement;
        const typing = focused && (focused.tagName === 'INPUT' || focused.tagName === 'SELECT');

        if (e.code === 'Escape') {
            if (OptionPopup.hideTop()) return;
            if (this.app.settingsManager.shown) return this.app.settingsMenu.hideMenu();
            if (this.sortOpen) return this.toggleSort(false);
            if (this.current === 'home') this.showQuit();
            else this.transition('home');
            return;
        }
        if (typing) return;

        if (e.ctrlKey && e.code === 'KeyO') {
            e.preventDefault();
            this.app.settingsMenu.toggle();
            return;
        }
        if (e.ctrlKey && e.code === 'F4') {
            e.preventDefault();
            this.mapList.pickRandom();
            return;
        }
        if (this.app.settingsManager.shown || OptionPopup.anyShown()) return;

        if (this.current === 'play') {
            if (e.code === 'F2') {
                e.preventDefault();
                this.mapList.shuffle();
                return;
            }
            if (e.code === 'Space') {
                e.preventDefault();
                this.app.playSelected();
                return;
            }
            // type-to-search
            if (!e.ctrlKey && !e.altKey && !e.metaKey && e.key.length === 1) {
                this.searchInput.focus();
            }
        }
    }

    onMouseDown(e) {
        if (e.button === 3) this.transition('home');
        else if (e.button === 4) this.transition(this.last);
        else if (e.button === 2) this.mapInfo.onRightClick();
    }

    update(delta) {
        const now = performance.now();
        if (this.current === 'play' || this.play.style.opacity > 0) {
            this.mapList.update(delta, now);
            this.mapInfo.update(delta);
        }
        if (this.current === 'extras') {
            const m = this.app.mouse;
            for (const o of [this.statsOutline, this.creditsOutline]) o.style.background = outlineBackground(o.getBoundingClientRect(), 0, m, null);
        }
        this.jukebox.update(delta);
    }

    render(backend) {
        const space = this.app.sceneManager.space;
        if (space) backend.render(space.world, space.camera);
    }
}
