/**
 * Googleカレンダーから今日の予定を取得し、Discordの指定チャンネルに通知するスクリプト
 *
 * 設定箇所:
 * スクリプトプロパティに以下のキーと値を設定してください。
 * 1. CALENDAR_IDS: 通知したいGoogleカレンダーのIDをカンマ区切りで指定します。
 * 例: 'your_main_calendar_id@gmail.com,your_shared_calendar_id@group.calendar.google.com'
 * 2. DISCORD_WEBHOOK_URL: 通知先のDiscord WebhookのURLを指定します。
 * 例: 'https://discord.com/api/webhooks/...'
 *
 * スクリプトプロパティの設定方法:
 * スクリプトエディタで「プロジェクトの設定」（歯車アイコン）を開き、「スクリプト プロパティ」セクションで設定します。
 *
 * 使用方法:
 * 1. このコードをGoogle Apps Scriptのスクリプトエディタに貼り付けます。
 * 2. 上記の説明に従ってスクリプトプロパティを設定します。
 * 3. スクリプトを保存し、初回実行時に必要な権限を承認します。
 * 4. GASのトリガーを設定し、定期的にこのスクリプトを実行するようにします。
 */

// --- 設定はスクリプトプロパティで行います ---
// var CALENDAR_IDS; // スクリプトプロパティから読み込みます
// var CALENDAR_DISCORD_WEBHOOK_URL;   // スクリプトプロパティから読み込みます
// --- 設定終了 ---


/**
 * スクリプトプロパティから設定値を読み込みます。
 * @returns {object} 設定値を含むオブジェクト { calendarIds, discordWebhookUrl }
 * @throws {Error} 設定値が不足している場合にエラーをスローします。
 */
function loadProperties() {
  var properties = PropertiesService.getScriptProperties().getProperties();

  var calendarIdsString = properties.CALENDAR_IDS;
  var discordWebhookUrl = properties.CALENDAR_DISCORD_WEBHOOK_URL;

  if (!calendarIdsString) {
    throw new Error('スクリプトプロパティ CALENDAR_IDS が設定されていません。');
  }
  if (!discordWebhookUrl) {
    throw new Error('スクリプトプロパティ CALENDAR_DISCORD_WEBHOOK_URL が設定されていません。');
  }

  // カレンダーIDの文字列をカンマで分割して配列に変換し、各要素の前後にある空白を削除
  var calendarIds = calendarIdsString.split(',').map(function(id) {
    return id.trim();
  }).filter(function(id) {
    return id !== ''; // 空の要素を除外
  });

  if (calendarIds.length === 0) {
     throw new Error('スクリプトプロパティ CALENDAR_IDS に有効なカレンダーIDが設定されていません。');
  }

  return {
    calendarIds: calendarIds,
    discordWebhookUrl: discordWebhookUrl
  };
}


/**
 * メイン関数：カレンダーの予定を取得し、Discordに通知する処理を実行します。
 * この関数をGASのトリガーから呼び出すことを想定しています。
 */
function checkCalendarAndNotifyDiscord() {
  var config;
  try {
    // スクリプトプロパティから設定値を読み込む
    config = loadProperties();
  } catch (e) {
    Logger.log('設定読み込みエラー: ' + e.message);
    // 設定エラーの場合は処理を中断
    return;
  }

  var CALENDAR_IDS = config.calendarIds;
  var DISCORD_WEBHOOK_URL = config.discordWebhookUrl;


  // 今日の開始時刻と終了時刻を設定
  // スクリプトが実行される環境のタイムゾーンが使用されます。
  // 必要であれば、プロジェクトのタイムゾーン設定を調整してください。
  var now = new Date();
  // 今日の日付で新しいDateオブジェクトを作成し、時刻を00:00:00.000に設定
  var startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
  // 今日の日付で新しいDateオブジェクトを作成し、時刻を23:59:59.999に設定
  var endOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);

  Logger.log('対象期間: ' + Utilities.formatDate(startOfToday, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss') + ' - ' + Utilities.formatDate(endOfToday, Session.getScriptTimeZone(), 'yyyy/MM/dd HH:mm:ss'));

  // 取得した予定情報を格納する配列
  // 各要素は { title, startTime, endTime, description, location, calendarName } の形式
  var allEventsWithCalendarInfo = [];

  Logger.log('指定された複数のカレンダーから予定を取得中...');

  // 設定された各カレンダーIDをループ処理
  for (var i = 0; i < CALENDAR_IDS.length; i++) {
    var calendarId = CALENDAR_IDS[i]; // <-- 修正: CALENDAR_IDS_TO_CHECK ではなく CALENDAR_IDS を使用
    var calendar = null; // カレンダーオブジェクトを格納する変数

    try {
      // カレンダーIDからカレンダーオブジェクトを取得
      calendar = CalendarApp.getCalendarById(calendarId);
    } catch (e) {
      // 無効なカレンダーIDなどのエラーを捕捉
      Logger.log('  エラー: カレンダーID "' + calendarId + '" の取得に失敗しました。IDを確認してください。エラー詳細: ' + e.toString());
      continue; // このカレンダーIDの処理をスキップして次へ
    }


    if (calendar) {
      var calendarName = calendar.getName(); // 取得したカレンダーの名前
      Logger.log('  カレンダー "' + calendarName + '" から予定を取得...');

      try {
        // Advanced Service (Calendar API) を使用してイベントを取得
        // カレンダーの予定だけでなくタスクを拾ってしまう問題への対応として、eventTypeをチェックするためにAPIを使用
        var optionalArgs = {
          timeMin: startOfToday.toISOString(),
          timeMax: endOfToday.toISOString(),
          singleEvents: true, // 繰り返し予定を展開
          orderBy: 'startTime',
          showDeleted: false
        };

        var response = Calendar.Events.list(calendarId, optionalArgs);
        var events = response.items;

        // 取得した各イベントにカレンダー名を付加したオブジェクトを作成
        var eventsWithInfo = [];

        if (events && events.length > 0) {
          events.forEach(function(event) {
            // eventType が 'default' のものだけを対象とする（タスク等を除外）
            // eventType プロパティがない場合は、従来のイベントとみなして含める
            if (event.eventType && event.eventType !== 'default') {
              return;
            }

            var startTime, endTime;
            // 終日イベントかどうかの判定
            if (event.start.date) {
              // 終日イベント ("yyyy-mm-dd")
              // スクリプトのタイムゾーンに合わせてDateオブジェクトを作成
              var startParts = event.start.date.split('-');
              startTime = new Date(startParts[0], startParts[1] - 1, startParts[2]);

              var endParts = event.end.date.split('-');
              endTime = new Date(endParts[0], endParts[1] - 1, endParts[2]);
            } else {
              // 時間指定イベント (ISO 8601 string)
              startTime = new Date(event.start.dateTime);
              endTime = new Date(event.end.dateTime);
            }

            eventsWithInfo.push({
              title: event.summary || '（タイトルなし）',
              startTime: startTime,
              endTime: endTime,
              description: event.description,
              location: event.location,
              calendarName: calendarName // イベントが属するカレンダー名
            });
          });
        }

        // 作成したオブジェクトの配列を全体のリストに結合
        allEventsWithCalendarInfo = allEventsWithCalendarInfo.concat(eventsWithInfo);

      } catch (e) {
        // イベント取得中のエラーを捕捉
        Logger.log('  エラー: カレンダー "' + calendarName + '" からの予定取得中にエラーが発生しました。エラー詳細: ' + e.toString());
        continue; // このカレンダーの処理をスキップして次へ
      }

    } else {
      // getCalendarByIdがnullを返した場合 (通常はtry-catchで捕捉されるが念のため)
       Logger.log('  警告: 指定されたカレンダーIDが見つかりませんでした: ' + calendarId);
    }
  }

  // 取得した全ての予定を時刻順に並べ替え
  // 複数のカレンダーの予定が混ざっていても時間順に表示されるようにします。
  allEventsWithCalendarInfo.sort(function(a, b) {
    return a.startTime.getTime() - b.startTime.getTime();
  });

  Logger.log('カレンダーからの予定取得完了。合計 ' + allEventsWithCalendarInfo.length + ' 件の予定が見つかりました。');

  // Discordに通知するメッセージを作成
  let messageText = "🗓️ 今日の予定はありません。"; // 予定がない場合のデフォルトメッセージ

  if (allEventsWithCalendarInfo.length > 0) {
    messageText = ""; // 予定がある場合のヘッダー

    // 取得した予定リストをループしてメッセージに追加
    for (let j = 0; j < allEventsWithCalendarInfo.length; j++) {
      const event = allEventsWithCalendarInfo[j];
      // 時刻をHH:mm形式にフォーマット (GASスクリプトのタイムゾーンを使用)
      const startTimeFormatted = Utilities.formatDate(event.startTime, Session.getScriptTimeZone(), 'HH:mm');
      const endTimeFormatted = Utilities.formatDate(event.endTime, Session.getScriptTimeZone(), 'HH:mm');

      // DiscordのMarkdown記法を使ってメッセージを作成
      messageText += `**${event.title}** (${startTimeFormatted} - ${endTimeFormatted})\n`; // タイトルと時刻を太字で表示
      messageText += `> カレンダー: ${event.calendarName}\n`; // カレンダー名を引用形式で表示
      // 必要であれば説明や場所も追加できます（メッセージが長くなりすぎないように注意）
      if (event.location && event.location.trim() !== '') messageText += `> 場所: ${event.location}\n`;
      // if (event.description && event.description.trim() !== '') messageText += `> 説明: ${event.description}\n`;

      // 最後の予定でない場合にのみ区切り線を追加
      if (j < allEventsWithCalendarInfo.length - 1) { // <-- 修正箇所
        messageText += "---\n";
      }
    }
  }

  // Discordに送信するJSONデータを作成
  // Discord Webhook APIの仕様に基づきます。
  const payload = {
    'content': messageText, // 通知メッセージの本文
    // オプション: Webhookのデフォルト設定を上書きしたい場合
    'username': '今日の予定', // Discordに表示される投稿者名
    // 'avatar_url': 'https://www.example.com/icon.png' // Discordに表示されるアイコン画像のURL
    // オプション: Embedsを使ってよりリッチな表示にする場合 (contentフィールドは省略可)
    // 'embeds': [ { "title": "...", "description": "...", "color": 1234567 } ]
  };

  // HTTP POSTリクエストのオプションを設定
  var options = {
    'method' : 'post', // HTTPメソッドはPOST
    'contentType': 'application/json', // 送信するデータの形式はJSON
    'payload' : JSON.stringify(payload), // JavaScriptオブジェクトをJSON文字列に変換してペイロードに設定
    'muteHttpExceptions': true // エラーが発生しても例外を投げずにレスポンスオブジェクトを返すようにする (エラーハンドリングのため推奨)
  };

  // Discord Webhookにリクエストを送信
  try {
    Logger.log('Discordにメッセージを送信中...');
    var response = UrlFetchApp.fetch(DISCORD_WEBHOOK_URL, options); // リクエスト実行

    var responseCode = response.getResponseCode(); // レスポンスのステータスコードを取得
    var responseText = response.getContentText(); // レスポンスの本文を取得

    // Discord WebhookへのPOST成功時は通常 204 No Content を返します
    if (responseCode >= 200 && responseCode < 300) {
      Logger.log('Discord通知成功。レスポンスコード: ' + responseCode);
    } else {
      // Discord API側でエラーが発生した場合
      Logger.log('Discord通知エラー。レスポンスコード: ' + responseCode);
      Logger.log('レスポンス本文: ' + responseText);
      // Discord APIのエラー情報はレスポンス本文(JSON)に含まれることがあります
      try {
         var errorJson = JSON.parse(responseText);
         Logger.log('Discordエラー詳細: ' + JSON.stringify(errorJson, null, 2));
      } catch (e) {
         // レスポンス本文がJSON形式でない場合
         Logger.log('DiscordエラーレスポンスはJSON形式ではありません。');
      }
    }

  } catch (e) {
    // UrlFetchApp自体のエラー (例: 不正なURL、ネットワークエラーなど)
    Logger.log('UrlFetchAppエラーによりDiscordへの通知に失敗しました: ' + e.toString());
  }
}
