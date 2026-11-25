function putCSV() {
  const sheets = SpreadsheetApp.getActiveSpreadsheet().getSheets();
  let csvData = [["UserEmail", "APIUserName", "FirstName", "LastName", "PermissionSet", "CompanyName", "Group", "Language"]];
  sheets.forEach(sheet => {
    if (sheet.getName() == "共有事務グループ一覧") return;
    records = sheet.getDataRange().getValues();
    records.forEach(rec => {
      if (rec[0] == "氏名") return;
      //'吉田 翔', 'yoshida@odk.co.jp', false
      if (rec[2]) {
        const [lastName, firstName] = rec[0].split(/[\s ]+/); 
        const addedRec = [rec[1], "", firstName, lastName, "DS Sender", "株式会社ODKソリューションズ", sheet.getName(), "ja"];
        csvData.push(addedRec);
      }
    });
  });
    
  console.log(csvData);
  return sheets;
}

function onOpen() {
  const ui = SpreadsheetApp.getUi();
  ui.createMenu('⚙️ Docusign管理')
    .addItem('メンテナンス用データ作成', 'createMaintenanceSheet') // チェッカ.js
    .addToUi();
}
