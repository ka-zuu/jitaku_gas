// 【重要】スクリプトプロパティに必要な情報を設定してください。
// SESAME_API_KEY
// SESAME_DEVICE_IDS (カンマ区切り)
// SESAME_DEVICE_NAMES (カンマ区切り、SESAME_DEVICE_IDSに対応、省略可)
// DISCORD_WEBHOOK_URL

function checkMultiSesameStatusAndNotifyDiscord() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('SESAME_API_KEY');
  const deviceIdsString = scriptProperties.getProperty('SESAME_DEVICE_IDS');
  const deviceNamesString = scriptProperties.getProperty('SESAME_DEVICE_NAMES'); // 省略可能
  const discordWebhookUrl = scriptProperties.getProperty('SESAME_DISCORD_WEBHOOK_URL');

  if (!apiKey || !deviceIdsString || !discordWebhookUrl) {
    console.error('必要な情報（APIキー, デバイスID(複数), Webhook URL）がスクリプトプロパティに設定されていません。');
    if (discordWebhookUrl) {
      sendDiscordNotification(discordWebhookUrl, 'スクリプト実行エラー: 必要な設定が不足しています。スクリプトプロパティを確認してください。');
    }
    return;
  }

  const deviceIds = deviceIdsString.split(',').map(id => id.trim()).filter(id => id);
  let deviceNames = [];
  if (deviceNamesString) {
    deviceNames = deviceNamesString.split(',').map(name => name.trim());
  }

  if (deviceIds.length === 0) {
    console.error('デバイスIDが設定されていません。SESAME_DEVICE_IDSプロパティを確認してください。');
    if (discordWebhookUrl) {
      sendDiscordNotification(discordWebhookUrl, 'スクリプト実行エラー: セサミのデバイスIDが設定されていません。');
    }
    return;
  }

  let unlockedDevices = []; // 解錠されたデバイスの情報を格納する配列

  for (let i = 0; i < deviceIds.length; i++) {
    const deviceId = deviceIds[i];
    const deviceDisplayName = (deviceNames[i] && deviceNames[i] !== '') ? deviceNames[i] : `デバイス(${deviceId.substring(0, 8)}...)`;

    try {
      const sesameApiUrl = `https://app.candyhouse.co/api/sesame2/${deviceId}`;
      const headers = {
        'x-api-key': apiKey
      };
      const options = {
        'method': 'get',
        'headers': headers,
        'muteHttpExceptions': true
      };

      console.log(`デバイス ${deviceDisplayName} (${deviceId}) の状態を取得中...`);
      const response = UrlFetchApp.fetch(sesameApiUrl, options);
      const responseCode = response.getResponseCode();
      const responseBody = response.getContentText();

      if (responseCode === 200) {
        const sesameStatus = JSON.parse(responseBody);
        let currentStatusJp = '';
        let isUnlocked = false;

        // CHSesame2Status の値に基づいて状態を判断
        if (sesameStatus.CHSesame2Status === "locked") {
          currentStatusJp = '施錠';
        } else if (sesameStatus.CHSesame2Status === "unlocked") {
          currentStatusJp = '解錠';
          isUnlocked = true; // 解錠の場合のみ通知対象
        } else if (sesameStatus.CHSesame2Status === "moved") {
          currentStatusJp = '動作中';
          // "moved" は通知しない
        } else {
          currentStatusJp = `不明 (${sesameStatus.CHSesame2Status})`;
          console.warn(`デバイス ${deviceDisplayName}: 未知のステータスです - ${sesameStatus.CHSesame2Status}`);
        }

        let batteryInfo = sesameStatus.batteryPercentage ? `(バッテリー: ${sesameStatus.batteryPercentage}%)` : '';
        console.log(`デバイス ${deviceDisplayName}: ${currentStatusJp} ${batteryInfo}`);

        if (isUnlocked) {
          unlockedDevices.push({
            name: deviceDisplayName,
            status: currentStatusJp, // "解錠"
            battery: batteryInfo
          });
        }
      } else {
        const errorMessage = `デバイス ${deviceDisplayName} の状態取得に失敗。コード: ${responseCode}, レスポンス: ${responseBody}`;
        console.error(errorMessage);
      }
    } catch (e) {
      const errorMessage = `デバイス ${deviceDisplayName} の処理中にエラー: ${e.message}`;
      console.error(errorMessage);
    }
    // APIのレートリミットを避けるために短い待機時間を挟む (任意)
    // Utilities.sleep(1000); // 1秒待機
  }

  // 解錠されたデバイスが1台でもあれば通知
  if (unlockedDevices.length > 0) {
    let notificationMessage = "🔓 **セサミ解錠通知** 🔓\n\n鍵が開いています:\n";
    for (const device of unlockedDevices) {
      notificationMessage += `- **${device.name}**: ${device.status} ${device.battery}\n`;
    }
    sendDiscordNotification(discordWebhookUrl, notificationMessage);
  } else {
    console.log('全ての監視対象セサミは施錠状態、または通知対象外の状態(動作中など)です。通知は行いません。');
  }
}

function sendDiscordNotification(webhookUrl, message) {
  const payload = JSON.stringify({
    'content': message
  });

  const params = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': payload,
    'muteHttpExceptions': true
  };

  try {
    const response = UrlFetchApp.fetch(webhookUrl, params);
    const responseCode = response.getResponseCode();
    if (responseCode === 204 || responseCode === 200) { // Discordは成功時204を返すことが多い
      console.log('Discordへの通知に成功しました。');
    } else {
      console.error(`Discordへの通知に失敗しました。ステータスコード: ${responseCode}, レスポンス: ${response.getContentText()}`);
    }
  } catch (e) {
    console.error(`Discordへの通知中にエラーが発生しました: ${e}`);
  }
}
