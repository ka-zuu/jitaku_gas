// ka-zuu/jitaku_gas/jitaku_gas-8226619302a73e22e23079ce474cc6fd24047405/src/SESAME解錠通知.js

// 【重要】スクリプトプロパティに必要な情報を設定してください。
// SESAME_API_KEY
// SESAME_DEVICE_IDS (カンマ区切り)
// SESAME_DEVICE_NAMES (カンマ区切り、SESAME_DEVICE_IDSに対応、省略可)
// SESAME_DISCORD_WEBHOOK_URL
// ※ Webアプリとして機能させるため、このスクリプトはdoPost(e)関数を含みます。

/**
 * メインのチェック関数。解錠されているセサミがあればボタン付きで通知します。
 * この関数を時間ベースのトリガーで定期実行してください。
 */
function checkMultiSesameStatusAndNotifyDiscord() {
  const scriptProperties = PropertiesService.getScriptProperties();
  const apiKey = scriptProperties.getProperty('SESAME_API_KEY');
  const deviceIdsString = scriptProperties.getProperty('SESAME_DEVICE_IDS');
  const deviceNamesString = scriptProperties.getProperty('SESAME_DEVICE_NAMES'); // 省略可能
  const discordWebhookUrl = scriptProperties.getProperty('SESAME_DISCORD_WEBHOOK_URL');

  if (!apiKey || !deviceIdsString || !discordWebhookUrl) {
    Logger.log('必要な情報（APIキー, デバイスID(複数), Webhook URL）がスクリプトプロパティに設定されていません。');
    if (discordWebhookUrl) {
      sendSimpleDiscordNotification(discordWebhookUrl, 'スクリプト実行エラー: 必要な設定が不足しています。スクリプトプロパティを確認してください。');
    }
    return;
  }

  const deviceIds = deviceIdsString.split(',').map(id => id.trim()).filter(id => id);
  let deviceNames = deviceNamesString ? deviceNamesString.split(',').map(name => name.trim()) : [];

  if (deviceIds.length === 0) {
    Logger.log('デバイスIDが設定されていません。SESAME_DEVICE_IDSプロパティを確認してください。');
    if (discordWebhookUrl) {
      sendSimpleDiscordNotification(discordWebhookUrl, 'スクリプト実行エラー: セサミのデバイスIDが設定されていません。');
    }
    return;
  }

  // 解錠されたデバイスごとに通知を送信
  for (let i = 0; i < deviceIds.length; i++) {
    const deviceId = deviceIds[i];
    const deviceDisplayName = (deviceNames[i] && deviceNames[i] !== '') ? deviceNames[i] : `デバイス(${deviceId.substring(0, 8)}...)`;

    try {
      const sesameStatus = getSesameStatus(deviceId, apiKey);
      if (sesameStatus && sesameStatus.unlocked) {
        // 解錠されている場合、ボタン付きの通知を送信
        const batteryInfo = sesameStatus.battery ? `(バッテリー: ${sesameStatus.battery}%)` : '';
        const message = `🔓 **${deviceDisplayName}** が解錠状態です ${batteryInfo}`;
        sendDiscordNotificationWithButton(discordWebhookUrl, message, deviceId, deviceDisplayName);
      } else if (sesameStatus) {
        Logger.log(`デバイス ${deviceDisplayName} は施錠済みまたは通知対象外の状態です。`);
      } else {
        // ステータス取得失敗
        Logger.log(`デバイス ${deviceDisplayName} の状態取得に失敗しました。`);
      }
    } catch (e) {
      Logger.log(`デバイス ${deviceDisplayName} の処理中にエラー: ${e.message}`);
    }
     // APIのレートリミットを避けるために短い待機時間を挟む
    Utilities.sleep(500);
  }
}

/**
 * 指定されたデバイスIDのSESAMEの状態を取得します。
 * @param {string} deviceId - SESAMEのデバイスID
 * @param {string} apiKey - SESAMEのAPIキー
 * @returns {object|null} ステータス情報 or null
 */
function getSesameStatus(deviceId, apiKey) {
  try {
    const sesameApiUrl = `https://app.candyhouse.co/api/sesame2/${deviceId}`;
    const headers = { 'x-api-key': apiKey };
    const options = { 'method': 'get', 'headers': headers, 'muteHttpExceptions': true };
    
    const response = UrlFetchApp.fetch(sesameApiUrl, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode === 200) {
      const status = JSON.parse(responseBody);
      return {
        unlocked: status.CHSesame2Status === "unlocked",
        battery: status.batteryPercentage
      };
    } else {
      Logger.log(`デバイス ${deviceId} の状態取得失敗。コード: ${responseCode}, レスポンス: ${responseBody}`);
      return null;
    }
  } catch (e) {
    Logger.log(`デバイス ${deviceId} の状態取得API呼び出し中にエラー: ${e.message}`);
    return null;
  }
}

/**
 * Discordにボタン付きの通知を送信します。
 * @param {string} webhookUrl - Discord Webhook URL
 * @param {string} message - 送信するメッセージ
 * @param {string} deviceId - ボタンに埋め込むデバイスID
 * @param {string} deviceName - ボタンのラベルに使用するデバイス名
 */
function sendDiscordNotificationWithButton(webhookUrl, message, deviceId, deviceName) {
  const payload = {
    "content": message,
    "components": [
      {
        "type": 1, // Action Row
        "components": [
          {
            "type": 2, // Button
            "style": 2, // Secondary (Grey)
            "label": `🔒 ${deviceName}を施錠`,
            "custom_id": `lock_${deviceId}` // ボタンを識別するためのID
          }
        ]
      }
    ]
  };

  const params = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify(payload),
    'muteHttpExceptions': true
  };

  UrlFetchApp.fetch(webhookUrl, params);
  Logger.log(`デバイス ${deviceName} の解錠通知をボタン付きで送信しました。`);
}

/**
 * シンプルなテキストメッセージをDiscordに送信します。（エラー通知用）
 */
function sendSimpleDiscordNotification(webhookUrl, message) {
  const params = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify({ 'content': message }),
    'muteHttpExceptions': true
  };
  UrlFetchApp.fetch(webhookUrl, params);
}


// --- ここからWebアプリ用のコード ---

/**
 * DiscordからのPOSTリクエストを処理するWebアプリのメイン関数。
 * @param {object} e - Google Apps Scriptのイベントオブジェクト
 */
function doPost(e) {
  // Discordからのリクエスト内容をパース
  const interaction = JSON.parse(e.postData.contents);

  // 1. PING-PONG (疎通確認)
  // DiscordがInteractions Endpoint URLの有効性を確認するために送信します。
  if (interaction.type === 1) { // PING
    return ContentService.createTextOutput(
      JSON.stringify({ "type": 1 }) // PONG
    ).setMimeType(ContentService.MimeType.JSON);
  }

  // 2. ボタンクリック処理
  if (interaction.type === 3) { // MESSAGE_COMPONENT (Button click, etc.)
    const customId = interaction.data.custom_id;

    if (customId.startsWith("lock_")) {
      const deviceId = customId.split("_")[1];
      const apiKey = PropertiesService.getScriptProperties().getProperty('SESAME_API_KEY');

      if (apiKey && deviceId) {
        lockSesame(deviceId, apiKey);
        // Discordに応答を返し、ボタンを押したことをユーザーに知らせる
        return ContentService.createTextOutput(
          JSON.stringify({
            "type": 4, // CHANNEL_MESSAGE_WITH_SOURCE
            "data": {
              "content": `✅ 「${interaction.message.components[0].components[0].label}」コマンドを送信しました。`,
              "flags": 64 // Ephemeral (本人にのみ表示されるメッセージ)
            }
          })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }
  }
  
  // 不明なリクエストの場合は空の応答を返す
  return ContentService.createTextOutput(JSON.stringify({})).setMimeType(ContentService.MimeType.JSON);
}

/**
 * SESAMEを施錠する関数
 * @param {string} deviceId - 施錠するデバイスのID
 * @param {string} apiKey - APIキー
 */
function lockSesame(deviceId, apiKey) {
  const cmd = 82; // 施錠コマンド
  const base64History = Utilities.base64Encode("Locked by GAS");

  const payload = JSON.stringify({
    cmd: cmd,
    history: base64History
  });

  const headers = {
    'x-api-key': apiKey,
    'Content-Type': 'application/json'
  };

  const options = {
    'method': 'post',
    'headers': headers,
    'payload': payload,
    'muteHttpExceptions': true
  };
  
  try {
    const response = UrlFetchApp.fetch(`https://app.candyhouse.co/api/sesame2/${deviceId}/cmd`, options);
    Logger.log(`施錠コマンド送信 result: ${response.getResponseCode()} - ${response.getContentText()}`);
  } catch(e) {
    Logger.log(`施錠コマンド送信中にエラー: ${e.toString()}`);
  }
}
