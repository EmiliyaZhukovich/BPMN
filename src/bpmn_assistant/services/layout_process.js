const { layoutProcess } = require('bpmn-auto-layout');
const fs = require('fs');
const path = require('path');

// Получаем путь к XML файлу из аргументов командной строки
const xmlFilePath = process.argv[2];

if (!xmlFilePath) {
  console.error('Usage: node layout_process.js <xml_file_path>');
  process.exit(1);
}

// Читаем XML файл
const bpmnXml = fs.readFileSync(xmlFilePath, 'utf-8');

// Вызываем layoutProcess
layoutProcess(bpmnXml)
  .then((layoutedXml) => {
    if (layoutedXml) {
      console.log(layoutedXml);
    } else {
      console.error('Layout process returned empty result');
      process.exit(1);
    }
  })
  .catch((error) => {
    console.error('Error processing BPMN XML:', error);
    process.exit(1);
  });
