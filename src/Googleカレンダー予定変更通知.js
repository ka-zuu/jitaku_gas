/**
 * Googleカレンダーで直近1時間に更新されたイベントをDiscordに通知するスクリプト (複数カレンダー対応版)
 * このスクリプトは、指定されたカレンダーの中から、直近1時間以内に最終更新されたイベント（新規作成または変更されたイベント）を検出します。
 * 削除されたイベントは検出できません。
 * 更新されたイベントがない場合は、Discordへの通知は行いません。
 *
 * 設定方法：
 * 1. Discordで通知したいチャンネルのWebhook URLを取得する。
 * 2. 通知したいGoogleカレンダーのIDをすべて取得する。（カレンダー設定画面などで確認できます）
 * 通常は「@group.calendar.google.com」で終わる形式や、Googleアカウントのメールアドレスです。
 * 3. GASのプロジェクトの「プロジェクトの設定」（左のギアアイコン）を開く。
 * 4. スクリプトプロパティに以下を追加し、保存する。
 * - キー: CALENDAR_DISCORD_WEBHOOK_URL, 値: 取得したDiscord Webhook URL
 * - キー: CALENDAR_IDS, 値: 取得したカレンダーIDをカンマ区切りで列挙 (例: 'id1@group.calendar.google.com,id2@group.calendar.google.com,your-email@gmail.com')
 * 5. この関数（sendCalendarUpdatesToDiscord）に対して、時間主導型のトリガーを設定する（例えば、1時間おきに実行するなど）。
 * 6. 必要な権限の承認を行う。
 */

function sendCalendarUpdatesToDiscord() {
  // --- 設定 ---
  const PROPERTIES_KEY_WEBHOOK_URL = 'CALENDAR_DISCORD_WEBHOOK_URL';   // Webhook URLを保存するプロパティのキー
  const PROPERTIES_KEY_CALENDAR_IDS = 'CALENDAR_IDS';         // カレンダーIDリストを保存するプロパティのキー (カンマ区切り)
  // どの期間のイベントをチェックするか（例：今日から365日後まで）。あまり広すぎると処理が重くなる可能性があります。
  // この期間内のイベントのうち、最終更新日時が直近1時間のものを検出します。
  const SEARCH_DATE_RANGE_DAYS = 365;
  // ----------------

  const webhookUrl = PropertiesService.getScriptProperties().getProperty(PROPERTIES_KEY_WEBHOOK_URL);
  const calendarIdsString = PropertiesService.getScriptProperties().getProperty(PROPERTIES_KEY_CALENDAR_IDS);

  // 設定チェック
  if (!webhookUrl) {
    Logger.log('Webhook URLが設定されていません。スクリプトプロパティを確認してください。');
    return;
  }
   if (!calendarIdsString) {
    Logger.log('カレンダーIDが設定されていません。スクリプトプロパティを確認してください。\n例: \'id1@group.calendar.google.com,id2@group.calendar.google.com\'');
    // Webhook URLは設定されているので、設定不備の通知は送る
    sendDiscordMessage(webhookUrl, 'カレンダーIDが設定されていません。スクリプトプロパティ「CALENDAR_IDS」を確認してください。');
    return;
  }

  // カレンダーID文字列を配列に分割し、前後の空白を削除
  const calendarIds = calendarIdsString.split(',').map(id => id.trim()).filter(id => id !== '');

  if (calendarIds.length === 0) {
       Logger.log('有効なカレンダーIDが見つかりませんでした。スクリプトプロパティ「CALENDAR_IDS」を確認してください。');
       // Webhook URLは設定されているので、設定不備の通知は送る
       sendDiscordMessage(webhookUrl, '有効なカレンダーIDが見つかりませんでした。スクリプトプロパティ「CALENDAR_IDS」を確認してください。');
       return;
  }


  // 直近1時間の期間を計算 (更新日時チェック用)
  const now = new Date();
  const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000); // 現在時刻の1時間前

  Logger.log('チェック対象期間 (更新日時): ' + oneHourAgo + ' から ' + now);

  // イベント検索期間を計算 (例: 今日から指定日数後まで)
  // 最終更新日時が直近1時間であっても、イベント自体の期間がこの範囲外だと取得できないため、ある程度広い範囲を指定します。
  const searchStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate()); // 今日から
  const searchEndDate = new Date(searchStartDate.getTime() + SEARCH_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000); // 指定日数後まで

  Logger.log('イベント検索期間: ' + searchStartDate + ' から ' + searchEndDate);

  // 最終結果を格納するオブジェクト (カレンダー名 -> イベントリスト)
  const allUpdatedEvents = {};
  let totalUpdatedEventsCount = 0;

  // 各カレンダーを処理
  for (const calendarId of calendarIds) {
    let calendar;
    let calendarName = calendarId; // 名前が取れない場合やエラー時のためにIDをデフォルト名とする
    const updatedEventsForThisCalendar = [];

    try {
      calendar = CalendarApp.getCalendarById(calendarId);
      if (!calendar) {
        Logger.log(`エラー: カレンダーID '${calendarId}' が見つかりませんでした。スキップします。`);
        continue; // このIDはスキップして次へ
      }
      calendarName = calendar.getName() || calendarId; // カレンダー名を取得、取れなければIDを使う
      Logger.log(`カレンダー '${calendarName}' (${calendarId}) をチェック中...`);

      // 指定期間のイベントを取得
      // getEventsByDataRange や getEventsForDay など、より絞り込んだメソッドも検討できますが、
      // 最終更新日時でフィルタリングするため、ここでは広い範囲で取得します。
      const events = calendar.getEvents(searchStartDate, searchEndDate);

      // 取得したイベントの中から、直近1時間以内に最終更新されたものをフィルタリング
      for (const event of events) {
        const lastUpdated = event.getLastUpdated();
        // 最終更新日時が直近1時間の範囲内にあるかチェック (oneHourAgo <= lastUpdated < now)
        if (lastUpdated >= oneHourAgo && lastUpdated < now) {
          // イベントの詳細情報を取得
          const title = event.getTitle();
          const startTime = event.getStartTime();
          const endTime = event.getEndTime();
          const isAllDay = event.isAllDayEvent();

          // getHtmlLink メソッドが存在するかチェックし、存在しない場合は代替テキストを使用
          let eventUrl = "リンクなし"; // デフォルト値
          if (typeof event.getHtmlLink === 'function') {
             eventUrl = event.getHtmlLink(); // イベントURLを取得
          }


          let timeString;
          if (isAllDay) {
            // 終日イベントの場合、開始日のみ表示 (終了日は通常翌日になるため)
             timeString = Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'yyyy-MM-dd (終日)');
          } else {
             timeString = `${Utilities.formatDate(startTime, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm')} - ${Utilities.formatDate(endTime, Session.getScriptTimeZone(), 'HH:mm')}`;
          }

          updatedEventsForThisCalendar.push({
            title: title,
            time: timeString,
            url: eventUrl,
            updatedAt: lastUpdated // デバッグ用に残しておくのも良い
          });
        }
      }

       // このカレンダーで更新されたイベントがあった場合のみ結果に追加
      if (updatedEventsForThisCalendar.length > 0) {
           allUpdatedEvents[calendarName] = updatedEventsForThisCalendar;
           totalUpdatedEventsCount += updatedEventsForThisCalendar.length;
           Logger.log(`カレンダー '${calendarName}' で ${updatedEventsForThisCalendar.length} 件の更新が見つかりました。`);
      } else {
          Logger.log(`カレンダー '${calendarName}' では更新が見つかりませんでした。`);
      }

    } catch (e) {
      Logger.log(`カレンダー '${calendarName}' (${calendarId}) の処理中にエラーが発生しました: ${e.toString()}`);
       // 特定カレンダーのエラーはログに記録するだけにし、他のカレンダーの処理は続行する
    }
  }

  // 更新されたイベントが0件の場合は、ここで処理を終了し、Discordに通知しない
  if (totalUpdatedEventsCount === 0) {
      Logger.log("直近1時間以内に更新されたイベントはありませんでした。Discordへの通知はスキップします。");
      return; // ここで関数を終了
  }


  // Discordに送信するメッセージを生成 (更新があった場合のみ実行される)
  const formattedNow = Utilities.formatDate(now, Session.getScriptTimeZone(), 'MM/dd HH:mm');
  let discordMessageContent = `🗓️ ${formattedNow} 時点での Googleカレンダーの直近1時間の更新 🗓️\n`;

  // カレンダーごとにまとめて表示
  for (const calendarName in allUpdatedEvents) {
      if (allUpdatedEvents.hasOwnProperty(calendarName)) {
          const eventList = allUpdatedEvents[calendarName];
          discordMessageContent += `▶️ ${calendarName}\n`; // カレンダーごとの見出し
          for (const event of eventList) {
              // URLが存在する場合はリンク形式で、存在しない場合はテキストで表示
              if (event.url && event.url !== "リンクなし") {
                  discordMessageContent += `- [${event.time}] [${event.title}](${event.url})\n`;
              } else {
                  discordMessageContent += `- [${event.time}] ${event.title} (${event.url})\n`;
              }
          }
           discordMessageContent += "\n"; // カレンダー間に空白行
      }
  }
  // Discordへメッセージを送信 (更新があった場合のみ実行される)
  sendDiscordMessage(webhookUrl, discordMessageContent);
}

/**
 * Discord Webhookへメッセージを送信するヘルパー関数
 * @param {string} url - Discord Webhook URL
 * @param {string} content - 送信するメッセージ内容
 */
function sendDiscordMessage(url, content) {
  const options = {
    'method': 'post',
    'contentType': 'application/json',
    'payload': JSON.stringify({
      'content': content,
      'username': 'カレンダー更新お知らせ', // カスタムユーザー名を設定する場合
      //'avatar_url': 'https://...' // カスタムアバターを設定する場合
    }),
    'muteHttpExceptions': true // エラーが発生してもスクリプトを停止しない
  };

  try {
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseBody = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Discordへの通知が成功しました。');
    } else {
      Logger.log('Discordへの通知が失敗しました。ステータスコード: ' + responseCode + ', レスポンス: ' + responseBody);
      // 必要であれば、ここに追加のエラー処理（例: 管理者へのメール通知）を記述
    }
  } catch (e) {
    Logger.log('Discordへの通知中にエラーが発生しました: ' + e.toString());
    // 必要であれば、ここに追加のエラー処理を記述
  }
}


/**
 * スクリプトプロパティにDiscord Webhook URLとカレンダーIDリストを設定するための一時的な関数。
 * 一度実行してURLを設定したら不要です。
 * ★使用時にこの関数内の値を書き換えてください★
 */
function setProperties() {
  const webhookUrl = 'ここにDiscord Webhook URLを貼り付けてください'; // ★ここを実際のURLに書き換える★
  // ★ここに通知したいカレンダーIDをカンマ区切りで列挙してください★
  // 例: 'your-email@gmail.com,calendar-id-1@group.calendar.google.com,calendar-id-2@group.calendar.google.com'
  const calendarIds = 'ここにカレンダーIDをカンマ区切りで貼り付けてください';

  if (webhookUrl === 'ここにDiscord Webhook URLを貼り付けてください' || calendarIds === 'ここにカレンダーIDをカンマ区切りで貼り付けてください') {
      Logger.log('setProperties関数内のURLまたはカレンダーIDが初期値のままです。値を書き換えてから実行してください。');
      return;
  }


  PropertiesService.getScriptProperties().setProperty('DISCORD_WEBHOOK_URL', webhookUrl);
  PropertiesService.getScriptProperties().setProperty('CALENDAR_IDS', calendarIds);
  Logger.log('Webhook URL と カレンダーIDリストをスクリプトプロパティに設定しました。');
}
