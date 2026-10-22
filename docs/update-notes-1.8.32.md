# v1.8.32

## 中文

新增 Token Rhythm 人民币可用余额显示。在“费用 → 额度”点击“添加 Token Rhythm 余额”，保存网站登录 Cookie 后启用，便可在侧栏和设置页查看。沿用 DSH 的额度卡片和凭据输入方式，可选择显示位置与刷新间隔。

查询使用当前官网账户页的钱包接口，显示 `availableBalanceCny`，避免把冻结金额或历史消费当作可用余额。未过期的结果直接复用；修改、清除凭据后旧余额作废。缺少有效金额或登录失效时给出明确提示。

感谢 [ykoneee](https://github.com/ykoneee) 提出 [#290](https://github.com/Han-1413141/dsh-cost-meter/issues/290) 并提供参考，感谢 [162568316 的开源插件](https://github.com/162568316/dsh-tokenrhythm-bill) 提供认证与字段参考。

[设置方法与验证范围](tokenrhythm-balance.md#中文)。更新后完全重启 DSH。

## English

Token Rhythm available CNY balance is now supported. Under Cost → Quotas, add a Token Rhythm balance card, save the website session cookie and enable the card. Display placement and refresh interval reuse the existing DSH quota UI.

The integration uses the current official wallet endpoint and `availableBalanceCny`, keeping frozen funds and historical spend separate. Fresh results are cached; changing or clearing credentials invalidates old results. Missing amounts and expired sessions produce clear errors.

Thanks to [ykoneee](https://github.com/ykoneee) for [issue #290 and the reference](https://github.com/Han-1413141/dsh-cost-meter/issues/290), and [162568316](https://github.com/162568316/dsh-tokenrhythm-bill) for the authentication and field reference.

See [setup and validation details](tokenrhythm-balance.md#english). Fully restart DSH after upgrading.
