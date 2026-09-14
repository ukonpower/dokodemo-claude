import React from 'react';
import s from './Collapse.module.scss';

interface CollapseProps {
  /** 開いているか */
  open: boolean;
  children: React.ReactNode;
  /** ラッパーに足すクラス（グリッド内での配置指定など） */
  className?: string;
}

/**
 * 中身を高さアニメーションで開閉するラッパー。
 *
 * トグルの結果が「ぱっと出る」と何が起きたか分からないため、
 * 高さと位置を伴って現れるようにする。閉じている間も DOM には残るが、
 * 閉じ切ったあとに visibility: hidden になるのでフォーカスは入らない。
 */
const Collapse: React.FC<CollapseProps> = ({ open, children, className }) => (
  <div
    className={`${s.root} ${open ? s.open : ''} ${className ?? ''}`}
    aria-hidden={!open}
  >
    <div className={s.inner}>
      <div className={s.content}>{children}</div>
    </div>
  </div>
);

export default Collapse;
