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
    .addItem('メンテナンス用データ作成', 'getAllSheet')
    .addToUi();
}

function getAllSheet() {
  const headerSheetName = "共有事務グループ一覧";
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const headerSheet = ss.getSheetByName(headerSheetName);
  const memberSheets = headerSheet.getDataRange().getValues().map(row => row[4]);
  const csvData = [["UserEmail", "APIUserName", "FirstName", "LastName", "PermissionSet", "CompanyName", "Group", "Language"]];
  //console.log(memberSheets.getLinkUrl());
  memberSheets.forEach((sheetName, index)=>{
    console.log(sheetName);
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(sheetName);
    if (sheet) {
      const members = sheet.getDataRange().getValues().filter(row => row[2] === true);
      if (members.length >0) {
        console.log(members);
        members.forEach((member, index)=>{
          const [lastName, firstName] = member[0].split(" ");
          const userId = getDocusignUserId(member[1]);
          if (userId) {
            csvData.push([member[1], userId, firstName, lastName, "DS Sender", "株式会社ODKソリューションズ", sheetName, "ja"]);
          }
        });
      }
    }  
  });
  console.log(csvData);
  if (csvData) {
    let sheet = ss.getSheetByName('メンテナンス用CSV');
    if (sheet) {
      sheet.clear();

    } else {
      sheet = ss.insertSheet('メンテナンス用CSV');
    }
    sheet.getRange(1, 1, csvData.length, csvData[0].length).setValues(csvData);
  }
  //const mailAddresses = csvData.slice(1).map(row => row[0]);
  //const dsUserIds = getDocusignUserId(mailAddresses);
 /* sheets.forEach((sheet, index)=>{
    console.log(sheet.getName());
    if (sheet.getName() == headerSheetName) {

    }
  });*/

}
