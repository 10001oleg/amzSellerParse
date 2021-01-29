# CloudFormation

1. Выполнить deploy (`bin/deploy.sh`), предварительно отредактировав скрипт

# Create instance (for parser or generator)

1. Создаем инстанс Amazon Linux 2
2. выполняем последовательно инструкции из файла bin/setup-ec2-puppeter.sh
3. Reboot

## Parser

1. Скопировать дерево подпапки parser на нужный instance
2. Создать файлы .env и amazon_creds.json в папке parser аналогично примеру parser/
3. Установить зависимости `npm install`
4. Запустить воркер через `npm start`

## Generator (server)

1. Скопировать дерево подпапки generator на нужный instance
2. Создать файлы .env и carrierAccounts.json в папке parser аналогично примеру parser/

- переменные S3_BUCKET берутся из deploy "Create Cloudformation" (выше)

3. Установить зависимости `npm install`
4. Запустить воркер через `npm start`

# WSS Examples

```json
{
  "orders": [
    {
      "order_id": 1341,
      "channel_order_id": "222-yy",
      "order_date": "2021-01-25T20:07:03.022Z",
      "seller": {
        "id": 1,
        "url": "https://www.amazon.com/sp?_encoding=UTF8&asin=&isAmazonFulfilled=&isCBA=&marketplaceID=ATVPDKIKX0DER&orderID=&protocol=current&seller=A2FE12E3V6UBSH&sshmPath=",
        "name": "Educator Direct"
      },
      "wh": {
        "code": "GA1",
        "PostalCode": "30071",
        "StateOrRegion": "GA",
        "City": "NORCROSS"
      },
      "ship_address": {
        "PostalCode": "33130-3789",
        "StateOrRegion": "FL",
        "City": "MIAMI"
      },
      "items": [
        {
          "product_id": 11,
          "asin": "B07QMV24Y8",
          "qty": 2,
          "price": 59.99,
          "img": "https://adh-dev-s3bucket-e1coe95dktqc.s3.us-west-2.amazonaws.com/B07QMV24Y8.jpg",
          "title": "ECR4Kids Foam Stacking Blocks, Soft Building Toys for Baby, Lightweight Stackable Cubes, Indoor Activities for Toddlers, Assorted Colors (7-Piece Set)",
          "pack": { "width": 13, "height": 13, "length": 19, "weight": 3 },
          "star": 4.7,
          "review": 125
        }
      ],
      "carrier": { "name": "UPS", "rate": 7.63 }
    },
    "..."
  ]
}
```

# Описание таблицы магазинов (store)

Столбцы:

- `store_id` автоинкрементальное поле
- `seller_id` ID seller (должно быть заполнено, _информационно_)
- `marketplace_id` ID маркетплейса, для Amazon US = 'ATVPDKIKX0DER'
- `url` URL страницы с товарами магазина (используется парсером)
- `data` jsonb
  - `disabled` _наличие_ этого ключа отключает использование этого магазина в проекте
  - `orderCountPerDay` число заказов в день
  - `sellerPage` указываю ссылку на карточку магазина (информационно)
  - `defProductState` значение по умолчанию для товаров магазина (число 1 или 0), если не указано = 1
- `name` наименование магазина (информационно)

# Описание таблицы товаров (product)

Заполняется парсеров со страницы товаров магазинов, указанных в таблице `store`

- `store_id` ID магазина (- `store`)
- `asin` значение распарсенного asin
- `data` данные полученные в результате парсинга страниц и обработке данныз по API
- `mws_product` данные полученные через MWS API
- `param` настройки для товара, указанные вручную
  - `state` - cостояние товара (число 1 или 0), если не указано, используется значение `defProductState` из `store`. Используется для отключения товара из выборки при создания заказа, чтобы можно было товар вручную выключить.

# Описание таблицы параметров (param)

Столбец `k` не используется (нужен только для человека)
Столбец `v` должен содержать объект с настройками, включая тип настроек (ключ `type`)
Пример фильтр товаров для заказов

```json
{
    "type": "orderProduct",
    "dimMax": 100,    #максимальные допустимые размеры
    "dimMin": 5,      #минимальные  допустимые размеры
    "weightMax": 100, #максимальный допустимый вес
    "weightMin": 2    #минимальный  допустимый вес
}
```
