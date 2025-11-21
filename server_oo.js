const express = require('express');
const { getAllOO, createOO, updateOO, deleteOO } = require('./bd');

const router = express.Router();

// Страница управления образовательным учреждением
router.get('/oo', async (req, res) => {
  try {
    console.log('🏛️ Загрузка страницы управления образовательным учреждением');
    const ooData = await getAllOO();
    res.render('oo', { 
      ooRecords: ooData,
      title: 'Образовательное учреждение'
    });
  } catch (error) {
    console.error('❌ Ошибка загрузки страницы oo:', error);
    res.status(500).render('error', { message: 'Ошибка загрузки страницы' });
  }
});

// API для работы с таблицей oo
router.get('/api/oo', async (req, res) => {
  try {
    console.log('🏛️ Загрузка записей образовательного учреждения');
    const ooData = await getAllOO();
    console.log(`✅ Загружено записей: ${ooData.length}`);
    res.json({ success: true, oo: ooData });
  } catch (error) {
    console.error('❌ Ошибка загрузки записей oo:', error);
    res.json({ success: false, error: error.message });
  }
});

router.post('/api/oo', async (req, res) => {
  try {
    const { code_omsu, code_oo, number_oo, name_oo, full_name } = req.body;
    
    if (!full_name) {
      return res.json({ success: false, error: 'Не указано полное наименование учреждения' });
    }
    
    console.log(`🏛️ Создание записи ОО: ${full_name}`);
    
    const record = await createOO({ code_omsu, code_oo, number_oo, name_oo, full_name });
    console.log(`✅ Запись создана: ID=${record.id}`);
    
    res.json({ success: true, record });
  } catch (error) {
    console.error('❌ Ошибка создания записи oo:', error);
    res.json({ success: false, error: error.message });
  }
});

router.put('/api/oo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { code_omsu, code_oo, number_oo, name_oo, full_name } = req.body;
    
    if (!full_name) {
      return res.json({ success: false, error: 'Не указано полное наименование учреждения' });
    }
    
    console.log(`🔄 Обновление записи ОО ID=${id}: ${full_name}`);
    
    const record = await updateOO(id, { code_omsu, code_oo, number_oo, name_oo, full_name });
    
    if (!record) {
      return res.json({ success: false, error: 'Запись не найдена' });
    }
    
    console.log(`✅ Запись обновлена: ID=${record.id}`);
    
    res.json({ success: true, record });
  } catch (error) {
    console.error('❌ Ошибка обновления записи oo:', error);
    res.json({ success: false, error: error.message });
  }
});

router.delete('/api/oo/:id', async (req, res) => {
  try {
    const { id } = req.params;
    console.log(`🗑️ Удаление записи ОО ID=${id}`);
    
    const record = await deleteOO(id);
    
    if (!record) {
      return res.json({ success: false, error: 'Запись не найдена' });
    }
    
    console.log(`✅ Запись удалена: ID=${id}`);
    
    res.json({ success: true, record });
  } catch (error) {
    console.error('❌ Ошибка удаления записи oo:', error);
    res.json({ success: false, error: error.message });
  }
});

module.exports = router;