ALTER TABLE recharge_settings ADD COLUMN IF NOT EXISTS description_en TEXT;

UPDATE recharge_settings SET description_en = 'Please contact customer service to confirm your L-Coin recharge.' 
WHERE description_en IS NULL AND description = '如需充值兰克币，请联系客服确认';

INSERT INTO recharge_settings (banner_image, description, description_en, enabled) VALUES (
  NULL,
  '欢迎充值兰克币！

**充值方式：**
- 联系客服热线：400-123-4567
- 前往前台办理充值
- 发送邮件至：support@lankegroup.com

**充值须知：**
- 充值金额最低为 100 兰克币
- 充值后即时到账
- 如有疑问请联系客服',
  'Welcome to recharge L-Coin!

**Recharge Methods:**
- Contact customer service hotline: 400-123-4567
- Visit the front desk to recharge
- Send email to: support@lankegroup.com

**Important Notes:**
- Minimum recharge amount is 100 L-Coin
- Recharge is credited immediately
- Please contact customer service if you have any questions',
  TRUE
) ON CONFLICT DO NOTHING;