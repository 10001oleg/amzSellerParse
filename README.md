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
          "product_id": 195,
          "asin": "B08LQXKK21",
          "qty": 1,
          "price": 39.99,
          "img": "https://adh-dev-s3bucket-e1coe95dktqc.s3.us-west-2.amazonaws.com/B08LQXKK21.jpg",
          "title": "ECR4Kids 27” Jumbo Floor Pillow for Kids and Adults, Classroom Pillows for Reading, Flexible Learning, Reading Nooks, Playrooms, Indoor and Outdoor Throw Pillows, Seafoam",
          "pack": { "width": 8, "height": 8, "length": 25, "weight": 5.2 }
        }
      ],
      "carrier": { "name": "UPS", "rate": 7.63 }
    },
    "..."
  ]
}
```
