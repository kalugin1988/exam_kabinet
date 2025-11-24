// Функции для печати документов
let currentClassroom = null;
let currentSchool = null;
let currentStudents = [];
let groupByParallel = true;
let currentFormat = 'R';
let currentGroupBy = 'classroom';

// Инициализация страницы печати
document.addEventListener('DOMContentLoaded', function() {
    console.log('=== ИНИЦИАЛИЗАЦИЯ СТРАНИЦЫ ПЕЧАТИ ===');
    
    if (window.location.pathname === '/print') {
        initializePrintPage();
    }
});

function initializePrintPage() {
    console.log('1. Запуск инициализации страницы печати');
    
    // Элементы управления
    const classroomSelect = document.getElementById('classroomSelect');
    const schoolSelect = document.getElementById('schoolSelect');
    const printBtn = document.getElementById('printBtn');
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    const bulkPrintBtn = document.getElementById('bulkPrintBtn');
    const groupByParallelCheckbox = document.getElementById('groupByParallel');
    const groupByRadios = document.querySelectorAll('input[name="groupBy"]');
    const formatRadios = document.querySelectorAll('input[name="format"]');

    // Загружаем список кабинетов по умолчанию
    loadClassroomsFromStudents();
    
    // Обработчики для переключения группировки
    groupByRadios.forEach(radio => {
        radio.addEventListener('change', function(e) {
            currentGroupBy = e.target.value;
            console.log(`🏫 Группировка: ${currentGroupBy}`);
            
            if (currentGroupBy === 'classroom') {
                document.getElementById('classroomGroup').style.display = 'block';
                document.getElementById('schoolGroup').style.display = 'none';
                loadClassroomsFromStudents();
            } else {
                document.getElementById('classroomGroup').style.display = 'none';
                document.getElementById('schoolGroup').style.display = 'block';
                loadSchoolsFromStudents();
            }
            
            resetData();
        });
    });

    // Обработчики для форматов
    formatRadios.forEach(radio => {
        radio.addEventListener('change', function(e) {
            currentFormat = e.target.value;
            console.log(`📋 Формат: ${currentFormat}`);
            if (currentStudents.length > 0) {
                updatePreview();
            }
        });
    });

    // Обработчики для основных элементов
    if (classroomSelect) {
        classroomSelect.addEventListener('change', handleClassroomChange);
    }

    if (printBtn) {
        printBtn.addEventListener('click', handlePrint);
    }

    if (exportExcelBtn) {
        exportExcelBtn.addEventListener('click', handleExportExcel);
    }

    if (bulkPrintBtn) {
        bulkPrintBtn.addEventListener('click', handleBulkPrint);
    }

    if (groupByParallelCheckbox) {
        groupByParallelCheckbox.addEventListener('change', function(e) {
            groupByParallel = e.target.checked;
            console.log(`📊 Группировка по параллелям: ${groupByParallel ? 'ВКЛ' : 'ВЫКЛ'}`);
            if (currentStudents.length > 0) {
                updatePreview();
            }
        });
    }
    
    console.log('✅ Инициализация завершена');
}

// Загрузка кабинетов из данных учеников
async function loadClassroomsFromStudents() {
    try {
        console.log('📋 Загрузка данных учеников для получения кабинетов...');
        
        const response = await fetch('/api/students');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.students) {
            // Получаем уникальные номера кабинетов
            const classrooms = [...new Set(result.students
                .filter(student => {
                    const hasClassroom = student.номер_кабинета !== null && student.номер_кабинета !== undefined;
                    const hasPlace = student.номер_места !== null && student.номер_места !== undefined;
                    return hasClassroom && hasPlace;
                })
                .map(student => parseInt(student.номер_кабинета))
            )].sort((a, b) => a - b);
            
            console.log('🏫 Найдены кабинеты с учениками:', classrooms);
            
            const select = document.getElementById('classroomSelect');
            if (select) {
                select.innerHTML = '<option value="">Выберите кабинет</option>';
                
                classrooms.forEach(classroomNumber => {
                    const option = document.createElement('option');
                    option.value = classroomNumber;
                    option.textContent = `Кабинет №${classroomNumber}`;
                    select.appendChild(option);
                });
                
                console.log(`✅ Загружено кабинетов: ${classrooms.length}`);
            }
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки кабинетов:', error);
        showNotification('Ошибка загрузки данных: ' + error.message, 'error');
    }
}

// Загрузка школ из данных учеников
async function loadSchoolsFromStudents() {
    try {
        console.log('🎓 Загрузка данных учеников для получения школ...');
        
        const response = await fetch('/api/students');
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.students) {
            // Получаем уникальные школы
            const schoolsMap = new Map();
            
            result.students
                .filter(student => {
                    const hasSchool = student.school_number_oo || student.school_code;
                    const hasPlace = student.номер_кабинета && student.номер_места;
                    return hasSchool && hasPlace;
                })
                .forEach(student => {
                    const schoolCode = student.school_number_oo || student.school_code;
                    const schoolName = student.school_name_oo || student.school_name || `Школа ${schoolCode}`;
                    
                    if (!schoolsMap.has(schoolCode)) {
                        schoolsMap.set(schoolCode, {
                            code: schoolCode,
                            name: schoolName,
                            count: 0
                        });
                    }
                    schoolsMap.get(schoolCode).count++;
                });
            
            const schools = Array.from(schoolsMap.values())
                .sort((a, b) => a.name.localeCompare(b.name));
            
            console.log('🏫 Найдены школы:', schools);
            
            const select = document.getElementById('schoolSelect');
            if (select) {
                select.innerHTML = '<option value="">Выберите школу</option>';
                
                schools.forEach(school => {
                    const option = document.createElement('option');
                    option.value = school.code;
                    option.textContent = `${school.name} (${school.count} уч.)`;
                    select.appendChild(option);
                });
                
                console.log(`✅ Загружено школ: ${schools.length}`);
                
                // Добавляем обработчик изменения школы
                select.addEventListener('change', handleSchoolChange);
            }
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки школ:', error);
        showNotification('Ошибка загрузки школ: ' + error.message, 'error');
    }
}

// Обработчик изменения кабинета
async function handleClassroomChange(event) {
    const classroomNumber = event.target.value;
    console.log('🎯 Выбран кабинет:', classroomNumber);
    
    if (!classroomNumber) {
        resetData();
        return;
    }
    
    try {
        showPreviewMessage('Загрузка данных учеников...');
        
        const response = await fetch('/api/students');
        
        if (!response.ok) {
            throw new Error(`Ошибка загрузки учеников: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.students) {
            // Фильтруем учеников по выбранному кабинету
            currentStudents = result.students.filter(student => {
                const inClassroom = parseInt(student.номер_кабинета) === parseInt(classroomNumber);
                const hasPlace = student.номер_места !== null && student.номер_места !== undefined;
                return inClassroom && hasPlace;
            });
            
            currentClassroom = { номер_кабинета: classroomNumber };
            currentSchool = null;
            
            console.log(`✅ Найдено учеников в кабинете ${classroomNumber}: ${currentStudents.length}`);
            
            updateActionButtons();
            updatePreview();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        showNotification('Ошибка загрузки данных: ' + error.message, 'error');
        resetData();
    }
}

// Обработчик изменения школы
async function handleSchoolChange(event) {
    const schoolCode = event.target.value;
    console.log('🎯 Выбрана школа:', schoolCode);
    
    if (!schoolCode) {
        resetData();
        return;
    }
    
    try {
        showPreviewMessage('Загрузка данных учеников...');
        
        const response = await fetch('/api/students');
        
        if (!response.ok) {
            throw new Error(`Ошибка загрузки учеников: ${response.status}`);
        }
        
        const result = await response.json();
        
        if (result.success && result.students) {
            // Фильтруем учеников по выбранной школе
            currentStudents = result.students.filter(student => {
                const inSchool = (student.school_number_oo === schoolCode) || (student.school_code === schoolCode);
                const hasPlace = student.номер_кабинета !== null && student.номер_места !== undefined;
                return inSchool && hasPlace;
            });
            
            // Находим название школы
            const schoolSelect = document.getElementById('schoolSelect');
            const selectedOption = schoolSelect.options[schoolSelect.selectedIndex];
            const schoolName = selectedOption.textContent.split(' (')[0];
            
            currentSchool = { 
                code: schoolCode,
                name: schoolName
            };
            currentClassroom = null;
            
            console.log(`✅ Найдено учеников в школе ${schoolCode}: ${currentStudents.length}`);
            
            updateActionButtons();
            updatePreview();
        }
    } catch (error) {
        console.error('❌ Ошибка загрузки данных:', error);
        showNotification('Ошибка загрузки данных: ' + error.message, 'error');
        resetData();
    }
}

// Сброс данных
function resetData() {
    currentClassroom = null;
    currentSchool = null;
    currentStudents = [];
    updateActionButtons();
    clearPreview();
}

// Показать сообщение в превью
function showPreviewMessage(message) {
    const preview = document.getElementById('documentPreview');
    if (preview) {
        preview.innerHTML = `<div class="no-preview">${message}</div>`;
    }
}

// Обновление кнопок действий
function updateActionButtons() {
    const hasData = currentStudents.length > 0;
    const printBtn = document.getElementById('printBtn');
    const exportExcelBtn = document.getElementById('exportExcelBtn');
    const bulkPrintBtn = document.getElementById('bulkPrintBtn');
    
    if (printBtn) printBtn.disabled = !hasData;
    if (exportExcelBtn) exportExcelBtn.disabled = !hasData;
    if (bulkPrintBtn) bulkPrintBtn.disabled = !hasData;
}

// Очистка превью
function clearPreview() {
    showPreviewMessage('Выберите параметры для просмотра документа');
}

// Обновление превью документа
function updatePreview() {
    console.log('👀 Обновление превью документа');
    
    if (currentStudents.length === 0) {
        return;
    }
    
    const preview = document.getElementById('documentPreview');
    if (!preview) {
        return;
    }
    
    if (currentFormat === 'R') {
        preview.innerHTML = generateFormRPreview();
    } else {
        preview.innerHTML = generateFormMPreview();
    }
    
    // Обновляем статистику
    updateStats();
}

// Обновление статистики
function updateStats() {
    const statsInfo = document.getElementById('statsInfo');
    const selectionType = document.getElementById('selectionType');
    const studentsCount = document.getElementById('studentsCount');
    const parallelsCount = document.getElementById('parallelsCount');
    const currentMode = document.getElementById('currentMode');
    
    if (statsInfo && currentStudents.length > 0) {
        statsInfo.style.display = 'block';
        selectionType.textContent = currentGroupBy === 'classroom' ? 'Кабинет' : 'Школа';
        studentsCount.textContent = currentStudents.length;
        
        // Подсчет уникальных параллелей
        const parallels = new Set();
        currentStudents.forEach(student => {
            parallels.add(student.паралель);
        });
        parallelsCount.textContent = parallels.size;
        
        currentMode.textContent = `${currentGroupBy === 'classroom' ? 'Кабинеты' : 'Школы'} | ${currentFormat === 'R' ? 'Форма Р' : 'Форма М'} | ${groupByParallel ? 'По параллелям' : 'Единый список'}`;
    }
}

// ========== ФОРМА Р ==========

// Генерация превью формы Р
function generateFormRPreview() {
    if (currentStudents.length === 0) return '';
    
    let html = '';
    
    if (groupByParallel) {
        // Группируем учеников по параллелям
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        // Генерируем документ для каждой параллели
        Object.keys(studentsByParallel).sort().forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            html += generateParallelDocumentR(parallel, parallelStudents);
        });
    } else {
        // Все ученики в одном документе
        html += generateSingleDocumentR(currentStudents);
    }
    
    // Добавляем опись
    html += generateInventoryPageR();
    
    return html;
}

// Генерация документа для параллели (Форма Р)
function generateParallelDocumentR(parallel, students) {
    const subject = students[0]?.предмет || 'Предмет';
    
    return `
        <div class="document-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                <div class="document-subtitle">ЛИСТ РЕГИСТРАЦИИ УЧАСТНИКОВ</div>
                <div class="parallel-info">Класс ${parallel}</div>
            </div>
            
            <table class="registration-table">
                <thead>
                    <tr>
                        <th width="5%">№ п/п</th>
                        <th width="15%">ОО</th>
                        <th width="10%">Класс</th>
                        <th width="30%">ФИО участника</th>
                        <th width="10%">Ауд.</th>
                        <th width="10%">Место</th>
                        <th width="20%">Подпись</th>
                    </tr>
                </thead>
                <tbody>
                    ${generateStudentsRowsR(students)}
                </tbody>
            </table>
        </div>
    `;
}

// Генерация единого документа (Форма Р)
function generateSingleDocumentR(students) {
    const subject = students[0]?.предмет || 'Предмет';
    const title = currentGroupBy === 'classroom' ? 
        `Кабинет №${currentClassroom?.номер_кабинета}` : 
        `${currentSchool?.name || currentSchool?.code}`;
    
    return `
        <div class="document-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                <div class="document-subtitle">ЛИСТ РЕГИСТРАЦИИ УЧАСТНИКОВ</div>
                <div class="parallel-info">${title}</div>
            </div>
            
            <table class="registration-table">
                <thead>
                    <tr>
                        <th width="5%">№ п/п</th>
                        <th width="15%">ОО</th>
                        <th width="10%">Класс</th>
                        <th width="30%">ФИО участника</th>
                        <th width="10%">Ауд.</th>
                        <th width="10%">Место</th>
                        <th width="20%">Подпись</th>
                    </tr>
                </thead>
                <tbody>
                    ${generateStudentsRowsR(students)}
                </tbody>
            </table>
        </div>
    `;
}

// Генерация строк таблицы для формы Р
function generateStudentsRowsR(students) {
    return students.map((student, index) => `
        <tr>
            <td class="text-center">${index + 1}</td>
            <td class="text-center">${getStudentSchoolCode(student)}</td>
            <td class="text-center">${student.паралель}</td>
            <td>${student.фимилия} ${student.имя} ${student.отчество || ''}</td>
            <td class="text-center">${student.номер_кабинета}</td>
            <td class="text-center">${student.номер_места}</td>
            <td class="signature-cell"></td>
        </tr>
    `).join('');
}

// Генерация страницы описи для формы Р
function generateInventoryPageR() {
    let totalStudents = currentStudents.length;
    let totalPages = 0;
    
    if (groupByParallel) {
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        Object.keys(studentsByParallel).forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            totalPages += Math.ceil(parallelStudents.length / 25);
        });
    } else {
        totalPages = Math.ceil(totalStudents / 25);
    }
    
    const studentsByParallel = {};
    currentStudents.forEach(student => {
        const parallel = student.паралель;
        if (!studentsByParallel[parallel]) {
            studentsByParallel[parallel] = [];
        }
        studentsByParallel[parallel].push(student);
    });
    
    return `
        <div class="document-page inventory-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-subtitle">ОПИСЬ ДОКУМЕНТОВ</div>
                <div class="parallel-info">
                    ${currentGroupBy === 'classroom' ? `Кабинет №${currentClassroom?.номер_кабинета}` : `Школа: ${currentSchool?.name || currentSchool?.code}`}
                </div>
            </div>
            
            <table class="inventory-table">
                <thead>
                    <tr>
                        <th width="15%">Класс</th>
                        <th width="15%">Количество учеников</th>
                        <th width="10%"></th>
                        <th width="30%">Количество страниц</th>
                        <th width="30%">Примечание</th>
                    </tr>
                </thead>
                <tbody>
                    ${groupByParallel ? 
                        Object.keys(studentsByParallel).sort().map(parallel => {
                            const parallelStudents = studentsByParallel[parallel];
                            const pages = Math.ceil(parallelStudents.length / 25);
                            return `
                                <tr>
                                    <td class="text-center">${parallel}</td>
                                    <td class="text-center">${parallelStudents.length}</td>
                                    <td></td>
                                    <td class="text-center">${pages}</td>
                                    <td></td>
                                </tr>
                            `;
                        }).join('') :
                        `
                        <tr>
                            <td class="text-center">Все классы</td>
                            <td class="text-center">${totalStudents}</td>
                            <td></td>
                            <td class="text-center">${totalPages}</td>
                            <td>Общий список</td>
                        </tr>
                        `
                    }
                    <tr class="total-row">
                        <td class="text-center"><strong>ИТОГО:</strong></td>
                        <td class="text-center"><strong>${totalStudents}</strong></td>
                        <td></td>
                        <td class="text-center"><strong>${totalPages}</strong></td>
                        <td></td>
                    </tr>
                </tbody>
            </table>
            
            <div class="inventory-footer">
                <p><strong>Всего документов:</strong> ${groupByParallel ? Object.keys(studentsByParallel).length : 1}</p>
                <p><strong>Общее количество страниц:</strong> ${totalPages}</p>
                <p><strong>Дата формирования:</strong> ${new Date().toLocaleDateString('ru-RU')}</p>
                <p><strong>Группировка:</strong> ${groupByParallel ? 'по параллелям' : 'единый список'}</p>
            </div>
        </div>
    `;
}

// ========== ФОРМА М ==========

// Генерация превью формы М
function generateFormMPreview() {
    if (currentStudents.length === 0) return '';
    
    let html = '';
    
    if (groupByParallel) {
        // Группируем учеников по параллелям
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        // Генерируем документ для каждой параллели
        Object.keys(studentsByParallel).sort().forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            html += generateParallelDocumentM(parallel, parallelStudents);
        });
    } else {
        // Все ученики в одном документе
        html += generateSingleDocumentM(currentStudents);
    }
    
    // Добавляем опись для формы М
    html += generateInventoryPageM();
    
    return html;
}

// Генерация документа для параллели (Форма М)
function generateParallelDocumentM(parallel, students) {
    const subject = students[0]?.предмет || 'Предмет';
    
    return `
        <div class="document-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                <div class="document-subtitle">ФОРМА М - МОНИТОРИНГ РАССАДКИ УЧАСТНИКОВ</div>
                <div class="parallel-info">Класс ${parallel}</div>
            </div>
            
            <table class="registration-table">
                <thead>
                    <tr>
                        <th width="5%">№ п/п</th>
                        <th width="25%">Школа</th>
                        <th width="10%">Класс</th>
                        <th width="30%">ФИО участника</th>
                        <th width="10%">Ауд.</th>
                        <th width="10%">Место</th>
                        <th width="10%">Примечание</th>
                    </tr>
                </thead>
                <tbody>
                    ${generateStudentsRowsM(students)}
                </tbody>
            </table>
        </div>
    `;
}

// Генерация единого документа (Форма М)
function generateSingleDocumentM(students) {
    const subject = students[0]?.предмет || 'Предмет';
    const title = currentGroupBy === 'classroom' ? 
        `Кабинет №${currentClassroom?.номер_кабинета}` : 
        `${currentSchool?.name || currentSchool?.code}`;
    
    return `
        <div class="document-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                <div class="document-subtitle">ФОРМА М - МОНИТОРИНГ РАССАДКИ УЧАСТНИКОВ</div>
                <div class="parallel-info">${title}</div>
            </div>
            
            <table class="registration-table">
                <thead>
                    <tr>
                        <th width="5%">№ п/п</th>
                        <th width="25%">Школа</th>
                        <th width="10%">Класс</th>
                        <th width="30%">ФИО участника</th>
                        <th width="10%">Ауд.</th>
                        <th width="10%">Место</th>
                        <th width="10%">Примечание</th>
                    </tr>
                </thead>
                <tbody>
                    ${generateStudentsRowsM(students)}
                </tbody>
            </table>
        </div>
    `;
}

// Генерация строк таблицы для формы М
function generateStudentsRowsM(students) {
    return students.map((student, index) => `
        <tr>
            <td class="text-center">${index + 1}</td>
            <td>${getStudentSchool(student)}</td>
            <td class="text-center">${student.паралель}</td>
            <td>${student.фимилия} ${student.имя} ${student.отчество || ''}</td>
            <td class="text-center">${student.номер_кабинета}</td>
            <td class="text-center">${student.номер_места}</td>
            <td class="text-center"></td>
        </tr>
    `).join('');
}

// Генерация страницы описи для формы М
function generateInventoryPageM() {
    let totalStudents = currentStudents.length;
    let totalPages = 0;
    
    if (groupByParallel) {
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        Object.keys(studentsByParallel).forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            totalPages += Math.ceil(parallelStudents.length / 25);
        });
    } else {
        totalPages = Math.ceil(totalStudents / 25);
    }
    
    const studentsByParallel = {};
    currentStudents.forEach(student => {
        const parallel = student.паралель;
        if (!studentsByParallel[parallel]) {
            studentsByParallel[parallel] = [];
        }
        studentsByParallel[parallel].push(student);
    });
    
    return `
        <div class="document-page inventory-page">
            <div class="document-header">
                <div class="school-name">${getSchoolName()}</div>
                <div class="document-subtitle">ОПИСЬ ДОКУМЕНТОВ (ФОРМА М)</div>
                <div class="parallel-info">
                    ${currentGroupBy === 'classroom' ? `Кабинет №${currentClassroom?.номер_кабинета}` : `Школа: ${currentSchool?.name || currentSchool?.code}`}
                </div>
            </div>
            
            <table class="inventory-table">
                <thead>
                    <tr>
                        <th width="15%">Класс</th>
                        <th width="15%">Количество учеников</th>
                        <th width="10%"></th>
                        <th width="30%">Количество страниц</th>
                        <th width="30%">Примечание</th>
                    </tr>
                </thead>
                <tbody>
                    ${groupByParallel ? 
                        Object.keys(studentsByParallel).sort().map(parallel => {
                            const parallelStudents = studentsByParallel[parallel];
                            const pages = Math.ceil(parallelStudents.length / 25);
                            return `
                                <tr>
                                    <td class="text-center">${parallel}</td>
                                    <td class="text-center">${parallelStudents.length}</td>
                                    <td></td>
                                    <td class="text-center">${pages}</td>
                                    <td>Форма М</td>
                                </tr>
                            `;
                        }).join('') :
                        `
                        <tr>
                            <td class="text-center">Все классы</td>
                            <td class="text-center">${totalStudents}</td>
                            <td></td>
                            <td class="text-center">${totalPages}</td>
                            <td>Форма М - Общий список</td>
                        </tr>
                        `
                    }
                    <tr class="total-row">
                        <td class="text-center"><strong>ИТОГО:</strong></td>
                        <td class="text-center"><strong>${totalStudents}</strong></td>
                        <td></td>
                        <td class="text-center"><strong>${totalPages}</strong></td>
                        <td></td>
                    </tr>
                </tbody>
            </table>
            
            <div class="inventory-footer">
                <p><strong>Всего документов:</strong> ${groupByParallel ? Object.keys(studentsByParallel).length : 1}</p>
                <p><strong>Общее количество страниц:</strong> ${totalPages}</p>
                <p><strong>Дата формирования:</strong> ${new Date().toLocaleDateString('ru-RU')}</p>
                <p><strong>Форма:</strong> М (Мониторинг)</p>
                <p><strong>Группировка:</strong> ${groupByParallel ? 'по параллелям' : 'единый список'}</p>
            </div>
        </div>
    `;
}

// ========== ВСПОМОГАТЕЛЬНЫЕ ФУНКЦИИ ==========

// Получить код школы ученика (для формы Р)
function getStudentSchoolCode(student) {
    return student.school_number_oo || student.school_code || "000000";
}

// Получить название школы ученика (для формы М)
function getStudentSchool(student) {
    return student.school_name_oo || student.school_name || "МОУ №1";
}

function getSchoolName() {
    return "МУНИЦИПАЛЬНОЕ АВТОНОМНОЕ ОБЩЕОБРАЗОВАТЕЛЬНОЕ УЧРЕЖДЕНИЕ - СРЕДНЯЯ ОБЩЕОБРАЗОВАТЕЛЬНАЯ ШКОЛА № 25 ИМЕНИ В.Г. ФЕОФАНОВА";
}

// ========== ПЕЧАТЬ ФОРМЫ Р ==========

function handlePrintR() {
    console.log('🖨️ Запуск печати формы Р');
    
    if (currentStudents.length === 0) {
        alert('Нет данных для печати');
        return;
    }
    
    const printContent = generateFormRPrintContent();
    const printWindow = window.open('', '_blank');
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Форма Р - ${currentGroupBy === 'classroom' ? `Кабинет ${currentClassroom?.номер_кабинета}` : `Школа ${currentSchool?.name}`}</title>
            <style>
                body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.2; margin: 1cm; }
                .print-page { page-break-after: always; }
                .print-header { text-align: center; margin-bottom: 20pt; }
                .school-name { font-size: 14pt; font-weight: bold; margin-bottom: 10pt; }
                .document-title { font-size: 12pt; font-weight: bold; margin-bottom: 5pt; }
                .document-subtitle { font-size: 12pt; font-weight: bold; margin-bottom: 5pt; text-transform: uppercase; }
                .parallel-info { font-size: 12pt; margin-bottom: 15pt; }
                .print-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
                .print-table th, .print-table td { border: 1px solid #000; padding: 4pt 6pt; text-align: left; }
                .print-table th { background-color: #f0f0f0; font-weight: bold; text-align: center; }
                .inventory-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
                .inventory-table th, .inventory-table td { border: 1px solid #000; padding: 6pt 8pt; text-align: left; }
                .inventory-table th { background-color: #e0e0e0; font-weight: bold; text-align: center; }
                .total-row { background-color: #f0f0f0; font-weight: bold; }
                .text-center { text-align: center; }
                .signature-cell { height: 20pt; }
                .inventory-footer { margin-top: 30pt; border-top: 2px solid #000; padding-top: 10pt; }
                .inventory-footer p { margin: 5pt 0; }
                @media print { .print-page { page-break-after: always; } }
            </style>
        </head>
        <body>${printContent}</body>
        </html>
    `);
    
    printWindow.document.close();
    
    setTimeout(() => {
        printWindow.print();
    }, 500);
}

// Генерация контента для печати формы Р
function generateFormRPrintContent() {
    if (currentStudents.length === 0) return '';
    
    let content = '';
    
    if (groupByParallel) {
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        Object.keys(studentsByParallel).sort().forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            content += generateParallelPrintContentR(parallel, parallelStudents);
        });
    } else {
        content += generateSinglePrintContentR(currentStudents);
    }
    
    content += generateInventoryPrintPageR();
    
    return content;
}

// Генерация контента для параллели (Форма Р)
function generateParallelPrintContentR(parallel, students) {
    const subject = students[0]?.предмет || 'Предмет';
    let content = '';
    let pageCount = 0;
    
    for (let i = 0; i < students.length; i += 25) {
        const pageStudents = students.slice(i, i + 25);
        pageCount++;
        
        content += `
            <div class="print-page">
                <div class="print-header">
                    <div class="school-name">${getSchoolName()}</div>
                    <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                    <div class="document-subtitle">ЛИСТ РЕГИСТРАЦИИ УЧАСТНИКОВ</div>
                    <div class="parallel-info">Класс ${parallel}${pageCount > 1 ? ` (лист ${pageCount})` : ''}</div>
                </div>
                
                <table class="print-table">
                    <thead>
                        <tr>
                            <th width="5%">№ п/п</th>
                            <th width="15%">ОО</th>
                            <th width="10%">Класс</th>
                            <th width="30%">ФИО участника</th>
                            <th width="10%">Ауд.</th>
                            <th width="10%">Место</th>
                            <th width="20%">Подпись</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${generatePrintStudentsRowsR(pageStudents, i)}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    return content;
}

// Генерация единого контента (Форма Р)
function generateSinglePrintContentR(students) {
    const subject = students[0]?.предмет || 'Предмет';
    const title = currentGroupBy === 'classroom' ? 
        `Кабинет №${currentClassroom?.номер_кабинета}` : 
        `${currentSchool?.name || currentSchool?.code}`;
    
    let content = '';
    let pageCount = 0;
    
    for (let i = 0; i < students.length; i += 25) {
        const pageStudents = students.slice(i, i + 25);
        pageCount++;
        
        content += `
            <div class="print-page">
                <div class="print-header">
                    <div class="school-name">${getSchoolName()}</div>
                    <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                    <div class="document-subtitle">ЛИСТ РЕГИСТРАЦИИ УЧАСТНИКОВ</div>
                    <div class="parallel-info">${title}${pageCount > 1 ? ` (лист ${pageCount})` : ''}</div>
                </div>
                
                <table class="print-table">
                    <thead>
                        <tr>
                            <th width="5%">№ п/п</th>
                            <th width="15%">ОО</th>
                            <th width="10%">Класс</th>
                            <th width="30%">ФИО участника</th>
                            <th width="10%">Ауд.</th>
                            <th width="10%">Место</th>
                            <th width="20%">Подпись</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${generatePrintStudentsRowsR(pageStudents, i)}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    return content;
}

// Генерация строк для печати (Форма Р)
function generatePrintStudentsRowsR(students, startIndex) {
    return students.map((student, index) => `
        <tr>
            <td class="text-center">${startIndex + index + 1}</td>
            <td class="text-center">${getStudentSchoolCode(student)}</td>
            <td class="text-center">${student.паралель}</td>
            <td>${student.фимилия} ${student.имя} ${student.отчество || ''}</td>
            <td class="text-center">${student.номер_кабинета}</td>
            <td class="text-center">${student.номер_места}</td>
            <td class="signature-cell"></td>
        </tr>
    `).join('');
}

// Генерация описи для печати (Форма Р)
function generateInventoryPrintPageR() {
    return generateInventoryPageR();
}

// ========== ПЕЧАТЬ ФОРМЫ М ==========

function handlePrintM() {
    console.log('🖨️ Запуск печати формы М');
    
    if (currentStudents.length === 0) {
        alert('Нет данных для печати');
        return;
    }
    
    const printContent = generateFormMPrintContent();
    const printWindow = window.open('', '_blank');
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Форма М - ${currentGroupBy === 'classroom' ? `Кабинет ${currentClassroom?.номер_кабинета}` : `Школа ${currentSchool?.name}`}</title>
            <style>
                body { font-family: 'Times New Roman', serif; font-size: 12pt; line-height: 1.2; margin: 1cm; }
                .print-page { page-break-after: always; }
                .print-header { text-align: center; margin-bottom: 20pt; }
                .school-name { font-size: 14pt; font-weight: bold; margin-bottom: 10pt; }
                .document-title { font-size: 12pt; font-weight: bold; margin-bottom: 5pt; }
                .document-subtitle { font-size: 12pt; font-weight: bold; margin-bottom: 5pt; text-transform: uppercase; }
                .parallel-info { font-size: 12pt; margin-bottom: 15pt; }
                .print-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
                .print-table th, .print-table td { border: 1px solid #000; padding: 4pt 6pt; text-align: left; }
                .print-table th { background-color: #f0f0f0; font-weight: bold; text-align: center; }
                .inventory-table { width: 100%; border-collapse: collapse; margin-bottom: 20pt; }
                .inventory-table th, .inventory-table td { border: 1px solid #000; padding: 6pt 8pt; text-align: left; }
                .inventory-table th { background-color: #e0e0e0; font-weight: bold; text-align: center; }
                .total-row { background-color: #f0f0f0; font-weight: bold; }
                .text-center { text-align: center; }
                .inventory-footer { margin-top: 30pt; border-top: 2px solid #000; padding-top: 10pt; }
                .inventory-footer p { margin: 5pt 0; }
                @media print { .print-page { page-break-after: always; } }
            </style>
        </head>
        <body>${printContent}</body>
        </html>
    `);
    
    printWindow.document.close();
    
    setTimeout(() => {
        printWindow.print();
    }, 500);
}

// Генерация контента для печати формы М
function generateFormMPrintContent() {
    if (currentStudents.length === 0) return '';
    
    let content = '';
    
    if (groupByParallel) {
        const studentsByParallel = {};
        currentStudents.forEach(student => {
            const parallel = student.паралель;
            if (!studentsByParallel[parallel]) {
                studentsByParallel[parallel] = [];
            }
            studentsByParallel[parallel].push(student);
        });
        
        Object.keys(studentsByParallel).sort().forEach(parallel => {
            const parallelStudents = studentsByParallel[parallel];
            content += generateParallelPrintContentM(parallel, parallelStudents);
        });
    } else {
        content += generateSinglePrintContentM(currentStudents);
    }
    
    content += generateInventoryPrintPageM();
    
    return content;
}

// Генерация контента для параллели (Форма М)
function generateParallelPrintContentM(parallel, students) {
    const subject = students[0]?.предмет || 'Предмет';
    let content = '';
    let pageCount = 0;
    
    for (let i = 0; i < students.length; i += 25) {
        const pageStudents = students.slice(i, i + 25);
        pageCount++;
        
        content += `
            <div class="print-page">
                <div class="print-header">
                    <div class="school-name">${getSchoolName()}</div>
                    <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                    <div class="document-subtitle">ФОРМА М - МОНИТОРИНГ РАССАДКИ УЧАСТНИКОВ</div>
                    <div class="parallel-info">Класс ${parallel}${pageCount > 1 ? ` (лист ${pageCount})` : ''}</div>
                </div>
                
                <table class="print-table">
                    <thead>
                        <tr>
                            <th width="5%">№ п/п</th>
                            <th width="25%">Школа</th>
                            <th width="10%">Класс</th>
                            <th width="30%">ФИО участника</th>
                            <th width="10%">Ауд.</th>
                            <th width="10%">Место</th>
                            <th width="10%">Примечание</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${generatePrintStudentsRowsM(pageStudents, i)}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    return content;
}

// Генерация единого контента (Форма М)
function generateSinglePrintContentM(students) {
    const subject = students[0]?.предмет || 'Предмет';
    const title = currentGroupBy === 'classroom' ? 
        `Кабинет №${currentClassroom?.номер_кабинета}` : 
        `${currentSchool?.name || currentSchool?.code}`;
    
    let content = '';
    let pageCount = 0;
    
    for (let i = 0; i < students.length; i += 25) {
        const pageStudents = students.slice(i, i + 25);
        pageCount++;
        
        content += `
            <div class="print-page">
                <div class="print-header">
                    <div class="school-name">${getSchoolName()}</div>
                    <div class="document-title">Олимпиада по "${subject}". Муниципальный тур</div>
                    <div class="document-subtitle">ФОРМА М - МОНИТОРИНГ РАССАДКИ УЧАСТНИКОВ</div>
                    <div class="parallel-info">${title}${pageCount > 1 ? ` (лист ${pageCount})` : ''}</div>
                </div>
                
                <table class="print-table">
                    <thead>
                        <tr>
                            <th width="5%">№ п/п</th>
                            <th width="25%">Школа</th>
                            <th width="10%">Класс</th>
                            <th width="30%">ФИО участника</th>
                            <th width="10%">Ауд.</th>
                            <th width="10%">Место</th>
                            <th width="10%">Примечание</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${generatePrintStudentsRowsM(pageStudents, i)}
                    </tbody>
                </table>
            </div>
        `;
    }
    
    return content;
}

// Генерация строк для печати (Форма М)
function generatePrintStudentsRowsM(students, startIndex) {
    return students.map((student, index) => `
        <tr>
            <td class="text-center">${startIndex + index + 1}</td>
            <td>${getStudentSchool(student)}</td>
            <td class="text-center">${student.паралель}</td>
            <td>${student.фимилия} ${student.имя} ${student.отчество || ''}</td>
            <td class="text-center">${student.номер_кабинета}</td>
            <td class="text-center">${student.номер_места}</td>
            <td class="text-center"></td>
        </tr>
    `).join('');
}

// Генерация описи для печати (Форма М)
function generateInventoryPrintPageM() {
    return generateInventoryPageM();
}

// ========== ОБЩИЕ ФУНКЦИИ ПЕЧАТИ ==========

// Обновление функции handlePrint для поддержки обеих форм
function handlePrint() {
    if (currentFormat === 'R') {
        handlePrintR();
    } else {
        handlePrintM();
    }
}

// Обработчик экспорта в Excel
async function handleExportExcel() {
    console.log('📊 Запуск экспорта в Excel');
    
    if (currentStudents.length === 0) {
        alert('Нет данных для экспорта');
        return;
    }
    
    if (typeof XLSX === 'undefined') {
        alert('Библиотека Excel не загружена');
        return;
    }
    
    try {
        // Простая реализация экспорта
        const workbook = XLSX.utils.book_new();
        const worksheetData = [
            ['ФИО', 'Класс', 'Школа', 'Кабинет', 'Место', 'Предмет'],
            ...currentStudents.map(student => [
                `${student.фимилия} ${student.имя} ${student.отчество || ''}`,
                student.паралель,
                student.school_name_oo || student.school_name || '',
                student.номер_кабинета,
                student.номер_места,
                student.предмет
            ])
        ];
        
        const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);
        XLSX.utils.book_append_sheet(workbook, worksheet, 'Ученики');
        
        const fileName = `Экспорт_${currentGroupBy === 'classroom' ? `Кабинет_${currentClassroom?.номер_кабинета}` : `Школа_${currentSchool?.code}`}.xlsx`;
        XLSX.writeFile(workbook, fileName);
        
        showNotification('✅ Файл Excel успешно сохранен', 'success');
    } catch (error) {
        console.error('❌ Ошибка экспорта:', error);
        alert('Ошибка экспорта: ' + error.message);
    }
}

// Обработчик массовой печати
function handleBulkPrint() {
    console.log('🚀 Запуск массовой печати');
    alert('Функция массовой печати находится в разработке');
}

// Показ уведомлений
function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification ${type}`;
    notification.textContent = message;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        padding: 10px 20px;
        background: ${type === 'success' ? '#4CAF50' : '#f44336'};
        color: white;
        border-radius: 5px;
        z-index: 10000;
    `;
    document.body.appendChild(notification);
    setTimeout(() => notification.remove(), 3000);
}