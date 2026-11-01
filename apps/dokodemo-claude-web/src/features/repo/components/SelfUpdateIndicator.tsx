/**
 * dokodemo-claude 自身に新しいリリースがあることを示すインジケーター。
 *
 * 表示のみで、更新の実行と更新先ブランチの切り替えは設定画面の「更新」セクションで行う。
 */
import { useRepositoryContext } from '@/features/repo/providers/RepositoryProvider';
import s from './SelfUpdateIndicator.module.scss';

function SelfUpdateIndicator() {
  const { repository } = useRepositoryContext();
  const { selfUpdateAvailable } = repository;

  if (!selfUpdateAvailable) return null;

  return (
    <span
      className={s.indicator}
      title="新しいリリースがあります。設定の「更新」から更新できます"
    >
      <span className={s.dot} />
      更新あり
    </span>
  );
}

export default SelfUpdateIndicator;
