/*
 * "Detect databases" picker for plugin configurations (SQL Server).
 *
 * Markup (rendered by clients/detail.php next to a field with 'picker' => true):
 *
 *   <div class="db-picker-wrap" data-agent-id data-config-id data-csrf>
 *     <input type="text" ...>                      the field that is saved
 *     <button class="db-picker-detect">            asks the client for its databases
 *     <div class="db-picker-status">
 *     <div class="db-picker-panel" hidden>
 *       <input type="checkbox" class="db-picker-all">   "All databases (*)"
 *       <div class="db-picker-list">                    one checkbox per database
 *
 * The saved connection settings are used: the button queues the same
 * plugin test job as the lightning button, and the agent returns the list of
 * databases it found next to the usual message. The checkboxes only write
 * into the text field (* or a comma-separated list), so the form saves
 * exactly what it always did and the field stays editable by hand.
 */
(function () {
    'use strict';

    var SYSTEM_DBS = ['master', 'model', 'msdb'];

    function esc(s) {
        var d = document.createElement('div');
        d.textContent = String(s);
        return d.innerHTML;
    }

    function parseList(value) {
        var v = String(value || '').trim();
        if (v === '*') return { all: true, names: [] };
        return { all: false, names: v.split(',').map(function (x) { return x.trim(); }).filter(Boolean) };
    }

    function Picker(wrap) {
        this.wrap = wrap;
        this.input = wrap.querySelector('input[type="text"]');
        this.btn = wrap.querySelector('.db-picker-detect');
        this.status = wrap.querySelector('.db-picker-status');
        this.panel = wrap.querySelector('.db-picker-panel');
        this.all = wrap.querySelector('.db-picker-all');
        this.list = wrap.querySelector('.db-picker-list');
        this.databases = [];
        var self = this;
        this.btn.addEventListener('click', function () { self.detect(); });
        this.all.addEventListener('change', function () { self.onAllChanged(); });
        this.list.addEventListener('change', function () { self.onListChanged(); });
        this.input.addEventListener('input', function () { if (self.databases.length) self.render(); });
    }

    Picker.prototype.setStatus = function (html, kind) {
        this.status.innerHTML = html ? '<div class="small mt-1 text-' + (kind || 'muted') + '">' + html + '</div>' : '';
    };

    Picker.prototype.detect = function () {
        var self = this;
        var base = '/clients/' + self.wrap.dataset.agentId + '/plugin-configs/' + self.wrap.dataset.configId;
        self.btn.disabled = true;
        self.setStatus('<span class="spinner-border spinner-border-sm me-1"></span> Asking the client for its databases...');

        function fail(msg) {
            self.btn.disabled = false;
            self.setStatus('<i class="bi bi-x-circle me-1"></i>' + esc(msg), 'danger');
        }

        fetch(base + '/test', { method: 'POST', credentials: 'same-origin', headers: { 'X-CSRF-Token': self.wrap.dataset.csrf } })
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data.job_id) return fail(data.error || 'Could not queue the request.');
                var started = Date.now();
                var timer = setInterval(function () {
                    fetch(base + '/test-status', { credentials: 'same-origin' })
                        .then(function (r) { return r.json(); })
                        .then(function (s) {
                            if (s.status === 'completed') {
                                clearInterval(timer);
                                self.btn.disabled = false;
                                if (!Array.isArray(s.databases)) return fail('The client did not return a database list.');
                                self.databases = s.databases;
                                self.setStatus('<i class="bi bi-check-circle me-1"></i>' + s.databases.length + ' database(s) found.', 'success');
                                self.render();
                            } else if (s.status === 'failed') {
                                clearInterval(timer);
                                fail(s.error || 'Detection failed.');
                            } else if (Date.now() - started > 90000) {
                                clearInterval(timer);
                                fail('Timed out. The client may be offline.');
                            }
                        })
                        .catch(function () { /* keep polling until the timeout */ });
                }, 2000);
            })
            .catch(function () { fail('Error contacting the server.'); });
    };

    // Draw the checkboxes from the databases found and the field's current value.
    Picker.prototype.render = function () {
        var cur = parseList(this.input.value);
        var chosen = {};
        cur.names.forEach(function (n) { chosen[n.toLowerCase()] = true; });
        this.all.checked = cur.all;
        var known = {};
        var html = '';
        this.databases.forEach(function (name, i) {
            known[name.toLowerCase()] = true;
            var comma = name.indexOf(',') !== -1;
            var system = SYSTEM_DBS.indexOf(name.toLowerCase()) !== -1;
            html += '<div class="form-check">' +
                '<input class="form-check-input db-picker-item" type="checkbox" id="dbp_' + esc(this.wrap.dataset.configId) + '_' + i + '"' +
                ' value="' + esc(name) + '"' + (comma ? ' data-comma="1"' : '') +
                ((cur.all || (!comma && chosen[name.toLowerCase()])) ? ' checked' : '') +
                (cur.all || comma ? ' disabled' : '') + '>' +
                '<label class="form-check-label small font-monospace" for="dbp_' + esc(this.wrap.dataset.configId) + '_' + i + '">' + esc(name) + '</label>' +
                (system ? ' <span class="badge text-bg-secondary">system</span>' : '') +
                (comma ? ' <span class="text-muted small">(name contains a comma: only selectable through *)</span>' : '') +
                '</div>';
        }, this);
        // Names typed by hand that the server did not report stay visible
        var missing = cur.names.filter(function (n) { return !known[n.toLowerCase()]; });
        missing.forEach(function (n) {
            html += '<div class="form-check"><input class="form-check-input db-picker-item" type="checkbox" checked value="' + esc(n) + '">' +
                '<label class="form-check-label small font-monospace text-warning">' + esc(n) + '</label> ' +
                '<span class="text-warning small">not found on the server</span></div>';
        });
        this.list.innerHTML = html || '<div class="text-muted small">No databases found.</div>';
        this.panel.hidden = false;
    };

    Picker.prototype.onAllChanged = function () {
        var items = this.list.querySelectorAll('.db-picker-item');
        if (this.all.checked) {
            this.input.value = '*';
            items.forEach(function (c) { c.checked = true; c.disabled = true; });
        } else {
            // A name containing a comma cannot be written into a comma-separated
            // list, so it is only ever covered by "All".
            items.forEach(function (c) {
                if (c.dataset.comma) { c.checked = false; c.disabled = true; } else { c.disabled = false; }
            });
            this.writeSelection();
        }
    };

    Picker.prototype.onListChanged = function () {
        this.writeSelection();
    };

    Picker.prototype.writeSelection = function () {
        var names = [];
        this.list.querySelectorAll('.db-picker-item').forEach(function (c) { if (c.checked && !c.dataset.comma) names.push(c.value); });
        this.input.value = names.join(', ');
        if (!names.length) this.setStatus('Select at least one database, or tick "All databases".', 'warning');
        else if (this.status.textContent.indexOf('Select at least') === 0) this.setStatus('');
    };

    function init(root) {
        (root || document).querySelectorAll('.db-picker-wrap').forEach(function (wrap) {
            if (!wrap.__picker) wrap.__picker = new Picker(wrap);
        });
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { init(); });
    else init();
    window.BBSDbPicker = { init: init, parseList: parseList };
})();
