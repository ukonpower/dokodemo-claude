/**
 * stylelint 設定 — デザイントークン準拠の機械的強制のみを目的とする。
 * プリセット（stylelint-config-standard 等）は入れない。目的特化の 3 ルールに限定する。
 *
 * 例外は各 SCSS に `/* stylelint-disable-next-line <rule> -- 理由 *\/` を付ける。
 * ルールの詳細は docs/design-system.md「強制（stylelint）」を参照。
 */
module.exports = {
  customSyntax: 'postcss-scss',
  rules: {
    // 1. hex 色の直書き禁止（色はトークンを参照する）
    'color-no-hex': true,

    // 2. 余白・3. タイポグラフィのリテラル禁止
    'declaration-property-value-disallowed-list': {
      // 余白: padding / margin / gap 系に px/rem/em リテラルを禁止（$space-* / 0 / auto / calc は通す）
      '/^padding/': [/\d(px|rem|em)/],
      '/^margin/': [/\d(px|rem|em)/],
      '/^(gap|row-gap|column-gap)$/': [/\d(px|rem|em)/],
      // font-size は $font-size-* のみ（px/rem/em リテラル禁止）
      'font-size': [/\d(px|rem|em)/],
      // font-weight は $font-weight-* のみ（数値リテラル禁止・inherit 等の語は通す）
      'font-weight': [/^\d+$/],
    },
  },
};
