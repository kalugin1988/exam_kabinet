'use strict';
(() => {
  const form = document.getElementById('printSettingsForm');
  if (!form) return;

  const grouping = document.getElementById('printGrouping');
  const selection = document.getElementById('printSelection');
  const selectionLabel = document.getElementById('printSelectionLabel');
  const selectionHelp = document.getElementById('printSelectionHelp');
  const parallel = document.getElementById('printParallel');
  const message = document.getElementById('printMessage');
  const preview = document.getElementById('printPreview');
  const previewStatus = document.getElementById('printPreviewStatus');
  const summary = document.getElementById('printSummary');
  const buttons = {
    preview: document.getElementById('printPreviewButton'),
    print: document.getElementById('printSelectedButton'),
    excel: document.getElementById('printExcelButton'),
    all: document.getElementById('printAllButton'),
    allExcel: document.getElementById('printAllExcelButton')
  };
  const escape = value => Exam.escape(value);
  const pageSize = 25;
  const collator = new Intl.Collator('ru', {numeric: true});
  let options = {classrooms: [], schools: []};
  let loadingOptions = true;
  let working = false;
  let previewRevision = 0;
  let cachedSelection = null;

  function settings(all = false) {
    return {
      groupBy: grouping.value,
      format: form.querySelector('input[name="printFormat"]:checked').value,
      selection: all ? 'all' : selection.value,
      grouped: parallel.checked
    };
  }

  function groupOptions() {
    return grouping.value === 'classroom' ? options.classrooms : options.schools;
  }

  function syncButtons() {
    const selected = Boolean(selection.value);
    const hasGroups = groupOptions().length > 0;
    for (const key of ['preview', 'print', 'excel']) buttons[key].disabled = working || loadingOptions || !selected;
    for (const key of ['all', 'allExcel']) buttons[key].disabled = working || loadingOptions || !hasGroups;
    selection.disabled = working || loadingOptions || !hasGroups;
    grouping.disabled = working || loadingOptions;
    parallel.disabled = working;
    form.querySelectorAll('input[name="printFormat"]').forEach(input => { input.disabled = working; });
  }

  function resetPreview() {
    previewRevision += 1;
    cachedSelection = null;
    summary.hidden = true;
    summary.replaceChildren();
    preview.innerHTML = '<div class="empty-state"><h3>Обновите предпросмотр</h3><p>Нажмите «Предпросмотр», чтобы подготовить документы с выбранными параметрами.</p></div>';
    previewStatus.textContent = 'Предпросмотр требует обновления';
    Exam.message(message, '');
    syncButtons();
  }

  function populateSelection() {
    const classrooms = grouping.value === 'classroom';
    const groups = groupOptions();
    selectionLabel.textContent = classrooms ? 'Кабинет' : 'Школа';
    buttons.all.textContent = classrooms ? 'Печать всех кабинетов' : 'Печать всех школ';
    buttons.allExcel.textContent = classrooms ? 'Excel всех кабинетов' : 'Excel всех школ';
    selection.replaceChildren(new Option(groups.length ? (classrooms ? 'Выберите кабинет' : 'Выберите школу') : 'Нет участников в этой группе', ''));
    for (const group of groups) selection.add(new Option(`${group.name} · ${group.studentCount} участников`, String(group.id)));
    selectionHelp.textContent = groups.length ? 'В списке показаны только группы с участниками.' : 'Импортируйте участников и выполните рассадку, чтобы подготовить документы.';
    resetPreview();
  }

  async function loadOptions() {
    try {
      const result = await Exam.request('/api/print/options');
      options = {
        classrooms: Array.isArray(result.options?.classrooms) ? result.options.classrooms : [],
        schools: Array.isArray(result.options?.schools) ? result.options.schools : []
      };
      loadingOptions = false;
      populateSelection();
    } catch (error) {
      loadingOptions = false;
      selection.replaceChildren(new Option('Не удалось загрузить группы', ''));
      selectionHelp.textContent = 'Обновите страницу, чтобы повторить загрузку.';
      Exam.message(message, error.message);
      syncButtons();
    }
  }

  function normalizedGroups(data) {
    if (!Array.isArray(data)) throw new Error('Сервер вернул некорректный список документов.');
    return data.map(group => ({
      title: String(group.title ?? 'Группа участников'),
      oo: String(group.oo && typeof group.oo === 'object' ? group.oo.full_name || group.oo.name_oo || '' : group.oo ?? ''),
      parallels: (Array.isArray(group.parallels) ? group.parallels : []).map(item => ({
        name: String(item.name ?? 'Не указан'),
        students: Array.isArray(item.students) ? item.students : []
      })).filter(item => item.students.length > 0).sort((a, b) => collator.compare(a.name, b.name))
    })).filter(group => group.parallels.length > 0);
  }

  async function loadGroups(config) {
    try {
      if (!config.selection) throw new Error('Выберите кабинет или школу.');
      const params = new URLSearchParams({groupBy: config.groupBy, format: config.format, selection: config.selection});
      const key = params.toString();
      if (config.selection !== 'all' && cachedSelection?.key === key) return cachedSelection.groups;
      const result = await Exam.request(`/api/print/bulk?${params}`);
      const groups = normalizedGroups(result.data);
      if (!groups.length) throw new Error('В выбранной группе нет участников. Обновите данные или выберите другую группу.');
      if (config.selection !== 'all') cachedSelection = {key, groups};
      return groups;
    } catch (error) { throw error; }
  }

  function documentsFor(group, config) {
    if (config.grouped) return group.parallels;
    return [{name: 'Все параллели', students: group.parallels.flatMap(item => item.students)}];
  }

  function countPages(groups, config) {
    return groups.reduce((counts, group) => {
      const documents = documentsFor(group, config);
      counts.students += documents.reduce((total, item) => total + item.students.length, 0);
      counts.lists += documents.reduce((total, item) => total + Math.ceil(item.students.length / pageSize), 0);
      counts.inventory += Math.ceil(documents.length / pageSize);
      counts.parallels += group.parallels.length;
      return counts;
    }, {students: 0, lists: 0, inventory: 0, parallels: 0});
  }

  function studentRows(students, start, config) {
    return students.map((student, index) => `<tr>
      <td class="print-centered">${escape(start + index + 1)}</td>
      <td>${escape(config.format === 'R' ? student.school_number_oo : (student.school_name_oo || student.school_number_oo))}</td>
      <td class="print-centered">${escape(student.parallel)}</td>
      <td>${escape(student.full_name)}</td>
      <td class="print-centered">${escape(student.classroom ?? '—')}</td>
      <td class="print-centered">${escape(student.place ?? '—')}</td>
      <td class="print-writing-cell"></td>
    </tr>`).join('');
  }

  function subjectText(students) {
    const subjects = [...new Set(students.map(student => String(student.предмет ?? '').trim()).filter(Boolean))];
    return subjects.length ? `Предмет: ${subjects.join(', ')}` : 'Муниципальный тур олимпиады';
  }

  function pageHeader(group, title, subtitle, subject = '') {
    return `<header class="print-page-heading">${group.oo ? `<p class="print-host">${escape(group.oo)}</p>` : ''}<h2>${escape(title)}</h2>${subject ? `<p>${escape(subject)}</p>` : ''}<p><strong>${escape(group.title)}</strong> · ${escape(subtitle)}</p></header>`;
  }

  function documentPages(group, config) {
    const documents = documentsFor(group, config);
    const pages = [];
    const title = config.format === 'R' ? 'Лист регистрации участников · Форма Р' : 'Мониторинг рассадки участников · Форма М';
    for (const item of documents) {
      const count = Math.ceil(item.students.length / pageSize);
      for (let start = 0; start < item.students.length; start += pageSize) {
        const current = Math.floor(start / pageSize) + 1;
        const subtitle = `${config.grouped ? `Параллель ${item.name}` : item.name} · Лист ${current} из ${count}`;
        pages.push(`<section class="print-page" aria-label="${escape(`${group.title} — ${subtitle}`)}">${pageHeader(group, title, subtitle, subjectText(item.students))}
          <table class="print-data-table"><colgroup><col style="width:5%"><col style="width:${config.format === 'R' ? '12' : '23'}%"><col style="width:7%"><col style="width:${config.format === 'R' ? '31' : '26'}%"><col style="width:8%"><col style="width:8%"><col style="width:${config.format === 'R' ? '29' : '23'}%"></colgroup>
          <thead><tr><th scope="col">№</th><th scope="col">${config.format === 'R' ? 'Код ОО' : 'Школа'}</th><th scope="col">Класс</th><th scope="col">ФИО участника</th><th scope="col">Ауд.</th><th scope="col">Место</th><th scope="col">${config.format === 'R' ? 'Подпись' : 'Примечание'}</th></tr></thead><tbody>${studentRows(item.students.slice(start, start + pageSize), start, config)}</tbody></table>
          <footer class="print-page-footer"><span>${escape(group.title)}</span><span>Форма ${config.format === 'R' ? 'Р' : 'М'} · ${escape(subtitle)}</span></footer></section>`);
      }
    }
    const totalStudents = documents.reduce((total, item) => total + item.students.length, 0);
    const totalPages = documents.reduce((total, item) => total + Math.ceil(item.students.length / pageSize), 0);
    const inventoryPages = Math.ceil(documents.length / pageSize);
    const date = new Intl.DateTimeFormat('ru-RU', {timeZone: 'Asia/Yekaterinburg'}).format(new Date());
    for (let start = 0; start < documents.length; start += pageSize) {
      const number = Math.floor(start / pageSize) + 1;
      const last = number === inventoryPages;
      pages.push(`<section class="print-page print-inventory" aria-label="${escape(`Опись — ${group.title}, лист ${number}`)}">${pageHeader(group, `Опись документов · Форма ${config.format === 'R' ? 'Р' : 'М'}`, `Лист ${number} из ${inventoryPages}`)}
        <table class="print-data-table"><thead><tr><th scope="col">Параллель</th><th scope="col">Участников</th><th scope="col">Листов</th><th scope="col">Документ</th><th scope="col">Примечание</th></tr></thead><tbody>${documents.slice(start, start + pageSize).map(item => `<tr><td>${escape(item.name)}</td><td class="print-centered">${escape(item.students.length)}</td><td class="print-centered">${escape(Math.ceil(item.students.length / pageSize))}</td><td>Форма ${config.format === 'R' ? 'Р' : 'М'}</td><td class="print-writing-cell"></td></tr>`).join('')}${last ? `<tr class="print-total"><th scope="row">Итого</th><td class="print-centered">${escape(totalStudents)}</td><td class="print-centered">${escape(totalPages)}</td><td colspan="2">Без учёта описи</td></tr>` : ''}</tbody></table>
        ${last ? `<div class="print-inventory-summary"><p>Комплектов по параллелям: <strong>${escape(documents.length)}</strong></p><p>Всего листов с описью: <strong>${escape(totalPages + inventoryPages)}</strong></p><p>Дата формирования: ${escape(date)}</p><p class="print-signature">Ответственный: __________________________ &nbsp; Подпись: ______________</p></div>` : ''}
        <footer class="print-page-footer"><span>${escape(group.title)}</span><span>Опись · ${escape(number)} / ${escape(inventoryPages)}</span></footer></section>`);
    }
    return pages.join('');
  }

  function renderDocuments(groups, config) {
    return `<div class="print-document">${groups.map(group => documentPages(group, config)).join('')}</div>`;
  }

  function showSummary(groups, config) {
    const counts = countPages(groups, config);
    summary.innerHTML = `<span><strong>${escape(groups.length)}</strong> ${config.groupBy === 'classroom' ? 'кабинетов' : 'школ'}</span><span><strong>${escape(counts.students)}</strong> участников</span><span><strong>${escape(counts.lists)}</strong> листов списков</span><span><strong>${escape(counts.inventory)}</strong> листов описи</span>`;
    summary.hidden = false;
    previewStatus.textContent = `Форма ${config.format === 'R' ? 'Р' : 'М'} · ${counts.lists + counts.inventory} листов`;
  }

  async function runAction(button, label, action) {
    if (working) return;
    working = true;
    syncButtons();
    Exam.message(message, '');
    try { await Exam.busy(button, label, action); }
    catch (error) { Exam.message(message, error.message); }
    finally { working = false; syncButtons(); }
  }

  async function updatePreview() {
    const config = settings();
    const revision = previewRevision;
    await runAction(buttons.preview, 'Подготовка…', async () => {
      try {
        previewStatus.textContent = 'Загрузка документов…';
        const groups = await loadGroups(config);
        if (revision !== previewRevision) return;
        preview.innerHTML = renderDocuments(groups, config);
        showSummary(groups, config);
      } catch (error) {
        previewStatus.textContent = 'Не удалось подготовить документы';
        throw error;
      }
    });
  }

  function openPrintWindow() {
    const popup = window.open('', '_blank');
    if (!popup) throw new Error('Браузер заблокировал окно печати. Разрешите всплывающие окна для этого сайта и повторите действие.');
    popup.opener = null;
    popup.document.open();
    popup.document.write('<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Подготовка документов</title></head><body><p>Подготовка документов к печати…</p></body></html>');
    popup.document.close();
    return popup;
  }

  async function waitForStyles(popup) {
    try {
      const stylesheet = popup.document.querySelector('link[rel="stylesheet"]');
      if (stylesheet.sheet) return;
      await new Promise((resolve, reject) => {
        let timer;
        const clear = () => {
          clearTimeout(timer);
          stylesheet.removeEventListener('load', loaded);
          stylesheet.removeEventListener('error', failed);
        };
        const loaded = () => { clear(); resolve(); };
        const failed = () => { clear(); reject(new Error('Не удалось загрузить оформление печати. Повторите действие.')); };
        stylesheet.addEventListener('load', loaded, {once: true});
        stylesheet.addEventListener('error', failed, {once: true});
        timer = setTimeout(failed, 15000);
      });
    } catch (error) { throw error; }
  }

  async function printDocuments(all, button) {
    if (working) return;
    let popup;
    try { popup = openPrintWindow(); }
    catch (error) { Exam.message(message, error.message); return; }
    const config = settings(all);
    await runAction(button, 'Подготовка печати…', async () => {
      try {
        const groups = await loadGroups(config);
        if (popup.closed) throw new Error('Окно печати было закрыто. Повторите действие.');
        const title = `Форма ${config.format === 'R' ? 'Р' : 'М'} · ${all ? 'Все группы' : groups[0].title}`;
        popup.document.open();
        popup.document.write(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(title)}</title><link rel="stylesheet" href="/assets/print.css"></head><body class="print-window"><header class="print-window-toolbar"><p>${escape(title)}</p><button type="button" id="nativePrintButton">Печать / Сохранить PDF</button></header><main>${renderDocuments(groups, config)}</main></body></html>`);
        popup.document.close();
        popup.document.getElementById('nativePrintButton').addEventListener('click', () => { popup.focus(); popup.print(); });
        await waitForStyles(popup);
        if (popup.closed) throw new Error('Окно печати было закрыто. Повторите действие.');
        popup.focus();
        popup.print();
        Exam.toast(`Подготовлено ${countPages(groups, config).lists + countPages(groups, config).inventory} листов. В окне печати можно сохранить PDF.`);
      } catch (error) {
        if (!popup.closed) popup.close();
        throw error;
      }
    });
  }

  function sheetName(value, names) {
    const base = String(value).replace(/[\\/?*\[\]:]/g, ' ').replace(/'/g, '').trim().slice(0, 31) || 'Участники';
    let name = base;
    let count = 2;
    while (names.has(name.toLocaleLowerCase('ru'))) {
      const suffix = ` (${count++})`;
      name = base.slice(0, 31 - suffix.length) + suffix;
    }
    names.add(name.toLocaleLowerCase('ru'));
    return name;
  }

  function appendSheet(workbook, rows, title, names) {
    const sheet = XLSX.utils.aoa_to_sheet(rows);
    sheet['!cols'] = [{wch: 7}, {wch: 30}, {wch: 10}, {wch: 42}, {wch: 13}, {wch: 10}, {wch: 26}, {wch: 20}];
    XLSX.utils.book_append_sheet(workbook, sheet, sheetName(title, names));
  }

  async function exportExcel(all, button) {
    const config = settings(all);
    await runAction(button, 'Создание Excel…', async () => {
      try {
        if (typeof XLSX === 'undefined') throw new Error('Не удалось загрузить модуль Excel. Обновите страницу и повторите действие.');
        const groups = await loadGroups(config);
        const workbook = XLSX.utils.book_new();
        const names = new Set();
        const inventory = [['Группа', 'Параллель', 'Участников', 'Листов', 'Форма']];
        for (const group of groups) {
          const documents = documentsFor(group, config);
          for (const item of documents) {
            const rows = [[group.title], [config.format === 'R' ? 'Форма Р · Регистрация участников' : 'Форма М · Мониторинг рассадки'], [config.grouped ? `Параллель ${item.name}` : 'Все параллели'], [], ['№', config.format === 'R' ? 'Код ОО' : 'Школа', 'Класс', 'ФИО участника', 'Аудитория', 'Место', config.format === 'R' ? 'Подпись' : 'Примечание', 'Предмет']];
            item.students.forEach((student, index) => rows.push([index + 1, String(config.format === 'R' ? student.school_number_oo ?? '' : student.school_name_oo || student.school_number_oo || ''), String(student.parallel ?? ''), String(student.full_name ?? ''), String(student.classroom ?? ''), String(student.place ?? ''), '', String(student.предмет ?? '')]));
            appendSheet(workbook, rows, `${group.title}${config.grouped ? ` ${item.name}` : ''}`, names);
            inventory.push([group.title, item.name, item.students.length, Math.ceil(item.students.length / pageSize), config.format === 'R' ? 'Р' : 'М']);
          }
        }
        const counts = countPages(groups, config);
        inventory.push(['Итого', '', counts.students, counts.lists, config.format === 'R' ? 'Р' : 'М']);
        appendSheet(workbook, inventory, 'Опись', names);
        const date = new Intl.DateTimeFormat('sv-SE', {timeZone: 'Asia/Yekaterinburg'}).format(new Date());
        const filename = `Форма_${config.format === 'R' ? 'Р' : 'М'}_${all ? 'Все_группы' : groups[0].title.replace(/[\\/:*?"<>|]/g, '_')}_${date}.xlsx`;
        XLSX.writeFile(workbook, filename);
        Exam.toast(`Excel готов: ${counts.students} участников, ${groups.length} групп.`);
      } catch (error) { throw error; }
    });
  }

  grouping.addEventListener('change', populateSelection);
  selection.addEventListener('change', resetPreview);
  parallel.addEventListener('change', resetPreview);
  form.querySelectorAll('input[name="printFormat"]').forEach(input => input.addEventListener('change', resetPreview));
  form.addEventListener('submit', async event => { event.preventDefault(); try { await updatePreview(); } catch (error) { Exam.message(message, error.message); } });
  buttons.print.addEventListener('click', async () => { try { await printDocuments(false, buttons.print); } catch (error) { Exam.message(message, error.message); } });
  buttons.all.addEventListener('click', async () => { try { await printDocuments(true, buttons.all); } catch (error) { Exam.message(message, error.message); } });
  buttons.excel.addEventListener('click', async () => { try { await exportExcel(false, buttons.excel); } catch (error) { Exam.message(message, error.message); } });
  buttons.allExcel.addEventListener('click', async () => { try { await exportExcel(true, buttons.allExcel); } catch (error) { Exam.message(message, error.message); } });
  syncButtons();
  void loadOptions();
})();
