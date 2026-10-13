'use strict';
(() => {
  const uploadForm = document.getElementById('uploadForm');
  const participantTable = document.getElementById('participantTable');
  const dataSource = document.getElementById('dataSource');
  const dataTable = document.getElementById('dataTable');
  const columnSelect = document.getElementById('filterColumn');
  const preview = document.getElementById('dataPreview');
  let participantTables = [];
  let offset = 0;
  let total = 0;
  const limit = 50;
  const help = {
    'participants/new':'Новый формат: первая строка содержит названия столбцов. Нужны ФИО или фамилия и имя, код участника и сведения о предмете.',
    participants:'Формат «Учащиеся (МЭ)»: загрузите исходный файл со сведениями об учащихся. Перед переносом в общий список укажите предмет экзамена.',
    scan:'Загрузите исходный файл результатов сканирования. Листы будут сохранены отдельно и доступны в разделе просмотра.',
    oo:'Загрузите справочник образовательных учреждений. Сведения появятся в разделе «Учреждения».'
  };
  const setOptions = (select,tables,key,label) => {
    select.innerHTML = '<option value="">Выберите таблицу</option>';
    tables.forEach(table => select.add(new Option(label(table),table[key])));
  };
  async function loadTables(preferred) {
    try {
      const result = await Exam.request('/import/participants/api/tables'); participantTables = result.tables || [];
      const selected = preferred || participantTable.value;
      setOptions(participantTable,participantTables,'name',table => `${table.name} · ${table.rowCount} строк`);
      if (participantTables.some(table => table.name === selected)) participantTable.value = selected;
      document.getElementById('rosterButton').disabled = !participantTables.length;
      if (dataSource.value === 'participants') {
        const previous = preferred || dataTable.value;
        setOptions(dataTable,participantTables,'name',table => `${table.name} · ${table.rowCount} строк`);
        if (participantTables.some(table => table.name === previous)) dataTable.value = previous;
      } else if (dataSource.value === 'scan') {
        const stats = await Exam.request('/import/scan/api/stats');
        setOptions(dataTable,stats.stats || [],'tableName',table => `${table.tableName} · ${table.recordCount} строк`);
      } else {
        dataTable.innerHTML = '<option value="oo">Учреждения</option>'; dataTable.value = 'oo';
      }
      columnSelect.innerHTML = '<option value="">Все столбцы</option>';
      offset = 0; await loadPreview();
    } catch (error) { Exam.message(document.getElementById('previewError'),error.message); }
  }
  function renderRows(rows,resetColumns) {
    if (!rows.length) { preview.innerHTML = '<div class="empty-state"><p>Строки не найдены.</p></div>'; return; }
    const columns = Object.keys(rows[0]);
    if (resetColumns) {
      const selected = columnSelect.value;
      columnSelect.innerHTML = '<option value="">Все столбцы</option>';
      columns.forEach(column => columnSelect.add(new Option(column,column)));
      if (columns.includes(selected)) columnSelect.value = selected;
    }
    preview.innerHTML = `<div class="table-scroll" tabindex="0" aria-label="Загруженные данные"><table><thead><tr>${columns.map(column => `<th scope="col">${Exam.escape(column)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(column => `<td title="${Exam.escape(row[column])}">${Exam.escape(row[column])}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
  }
  async function loadPreview() {
    Exam.message(document.getElementById('previewError'),'');
    if (!dataTable.value) { preview.innerHTML = '<div class="empty-state"><p>Сначала загрузите файл или выберите таблицу.</p></div>'; document.getElementById('previewInfo').textContent = 'Таблица не выбрана.'; total = 0; updatePagination(); return; }
    try {
      const filter = document.getElementById('dataFilter').value.trim();
      let rows;
      if (dataSource.value === 'participants') {
        const params = new URLSearchParams({limit:String(limit),offset:String(offset)});
        if (filter && columnSelect.value) params.set(columnSelect.value,filter);
        const result = await Exam.request(`/import/participants/api/table/${encodeURIComponent(dataTable.value)}?${params}`);
        rows = result.data; total = result.total;
        if (filter && !columnSelect.value) {
          Exam.message(document.getElementById('previewError'),'Для поиска по участникам выберите столбец.','info');
        }
      } else if (dataSource.value === 'scan') {
        const result = await Exam.request(`/import/scan/api/data?${new URLSearchParams({table:dataTable.value,filter})}`);
        rows = result.tables?.[0]?.data || []; total = rows.length;
      } else {
        const result = await Exam.request(`/import/oo/api/data?${new URLSearchParams({filter})}`);
        rows = result.data || []; total = result.total;
      }
      renderRows(rows,true);
      document.getElementById('previewInfo').textContent = rows.length ? `Строки ${offset + 1}–${offset + rows.length} · Всего: ${total}${dataSource.value === 'scan' && total === 1000 ? ' (показаны первые 1000)' : ''}` : 'Строки не найдены.';
      updatePagination();
    } catch (error) { Exam.message(document.getElementById('previewError'),error.message); }
  }
  function updatePagination() {
    document.getElementById('previousPage').disabled = dataSource.value !== 'participants' || offset === 0;
    document.getElementById('nextPage').disabled = dataSource.value !== 'participants' || offset + limit >= total;
  }
  document.getElementById('importType').addEventListener('change',event => { document.getElementById('formatHelp').textContent = help[event.target.value]; });
  uploadForm.addEventListener('submit',async event => {
    event.preventDefault(); Exam.message(document.getElementById('uploadError'),'');
    const file = document.getElementById('uploadFile').files[0]; if (!file) return;
    const resultBox = document.getElementById('uploadResult'); resultBox.hidden = true;
    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Поддерживаются только файлы .xlsx, .xls и .csv.');
      if (file.size > 20 * 1024 * 1024) throw new Error('Размер файла не должен превышать 20 МБ.');
      const multipart = new FormData(); multipart.append('file',file);
      const type = document.getElementById('importType').value;
      const result = await Exam.busy(document.getElementById('uploadButton'),'Загружаем…',() => Exam.request(`/import/${type}/load`,{method:'POST',body:multipart}));
      resultBox.innerHTML = `<div class="notice notice-success">${Exam.escape(result.message || 'Файл загружен.')}<br>Обработано строк: ${Number(result.totalRecords ?? result.processedRecords ?? 0)}</div>`;
      const sheets = result.sheets || result.results || [];
      if (sheets.length) resultBox.innerHTML += `<ul class="form-help">${sheets.map(sheet => `<li>${Exam.escape(sheet.sheetName)} · ${Number(sheet.rowCount ?? sheet.records ?? 0)} строк</li>`).join('')}</ul>`;
      resultBox.hidden = false;
      dataSource.value = type.startsWith('participants') ? 'participants' : type;
      document.getElementById('dataFilter').value = '';
      await loadTables(sheets[0]?.tableName);
    } catch (error) { Exam.message(document.getElementById('uploadError'),error.message); }
  });
  document.getElementById('rosterForm').addEventListener('submit',async event => {
    event.preventDefault(); Exam.message(document.getElementById('rosterError'),'');
    if (!participantTable.value) return;
    try {
      const subject = document.getElementById('rosterSubject').value.trim();
      const result = await Exam.busy(document.getElementById('rosterButton'),'Добавляем…',() => Exam.json('/import/participants/api/import-students','POST',{table:participantTable.value,...(subject ? {subject} : {})}));
      Exam.message(document.getElementById('rosterResult'),`Добавлено: ${result.inserted}. Обновлено: ${result.updated}. Пропущено: ${result.skipped}. Участники доступны для рассадки.`,'success');
    } catch (error) { Exam.message(document.getElementById('rosterError'),error.message); }
  });
  document.getElementById('reloadTables').addEventListener('click',() => loadTables());
  dataSource.addEventListener('change',() => { document.getElementById('dataFilter').value = ''; loadTables(); });
  dataTable.addEventListener('change',() => { offset = 0; columnSelect.innerHTML = '<option value="">Все столбцы</option>'; document.getElementById('dataFilter').value = ''; loadPreview(); });
  participantTable.addEventListener('change',() => { dataSource.value = 'participants'; loadTables(participantTable.value); });
  document.getElementById('filterForm').addEventListener('submit',event => { event.preventDefault(); offset = 0; loadPreview(); });
  document.getElementById('previousPage').addEventListener('click',() => { offset = Math.max(0,offset - limit); loadPreview(); });
  document.getElementById('nextPage').addEventListener('click',() => { offset += limit; loadPreview(); });
  loadTables();
})();
