export const messages = {
  en: {
    title: 'Platform assistant', subtitle: 'Ask about your platform and review VM proposals.',
    proposal: 'VM proposal', proposeOnly: 'Approving records this proposal. No VM will be created.',
    approve: 'Approve proposal', reject: 'Reject', pending: 'Review the full specification before approving.',
    approved_dry_run: 'Proposal approved. No VM was created.', rejected: 'Proposal rejected.',
    expired: 'This proposal has expired. Request a new one.', invalidated: 'The platform changed. Request a new proposal.',
    superseded: 'This proposal has been replaced.', changed: 'Review the updated proposal before approving.',
    busy: 'Recording your decision…', error: 'The request failed. Try again.', unavailable: 'This proposal is unavailable. Request a new one.',
    name: 'Name', template: 'Template', vcpus: 'vCPU', memory_mb: 'Memory (MiB)', disk_gb: 'Disk (GiB)',
    host: 'Host', sr: 'Storage (SR)', network: 'Network', tags: 'Tags',
  },
  fr: {
    title: 'Assistant de la plateforme', subtitle: 'Posez vos questions et examinez les propositions de VM.',
    proposal: 'Proposition de VM', proposeOnly: 'L’approbation enregistre cette proposition. Aucune VM ne sera créée.',
    approve: 'Approuver la proposition', reject: 'Refuser', pending: 'Vérifiez la configuration complète avant d’approuver.',
    approved_dry_run: 'Proposition approuvée. Aucune VM n’a été créée.', rejected: 'Proposition refusée.',
    expired: 'Cette proposition a expiré. Demandez-en une nouvelle.', invalidated: 'La plateforme a changé. Demandez une nouvelle proposition.',
    superseded: 'Cette proposition a été remplacée.', changed: 'Vérifiez la proposition mise à jour avant d’approuver.',
    busy: 'Enregistrement de votre décision…', error: 'La demande a échoué. Réessayez.', unavailable: 'Cette proposition est indisponible. Demandez-en une nouvelle.',
    name: 'Nom', template: 'Modèle', vcpus: 'vCPU', memory_mb: 'Mémoire (MiB)', disk_gb: 'Disque (GiB)',
    host: 'Hôte', sr: 'Stockage (SR)', network: 'Réseau', tags: 'Étiquettes',
  },
  ja: {
    title: 'プラットフォーム アシスタント', subtitle: '環境について質問し、VM の提案を確認できます。',
    proposal: 'VM の提案', proposeOnly: '承認すると、この提案が記録されます。VM は作成されません。',
    approve: '提案を承認', reject: '拒否', pending: '承認する前に、すべての設定を確認してください。',
    approved_dry_run: '提案を承認しました。VM は作成されていません。', rejected: '提案を拒否しました。',
    expired: 'この提案の有効期限が切れました。新しい提案を依頼してください。', invalidated: '環境の状態が変わりました。新しい提案を依頼してください。',
    superseded: 'この提案は新しい提案に置き換えられました。', changed: '更新された提案を確認してから承認してください。',
    busy: '判断を記録しています…', error: '処理に失敗しました。もう一度お試しください。', unavailable: 'この提案は利用できません。新しい提案を依頼してください。',
    name: '名前', template: 'テンプレート', vcpus: 'vCPU', memory_mb: 'メモリ (MiB)', disk_gb: 'ディスク (GiB)',
    host: 'ホスト', sr: 'ストレージ (SR)', network: 'ネットワーク', tags: 'タグ',
  },
}

export function language(locale) {
  const key = String(locale ?? 'en').toLowerCase().split(/[-_]/)[0]
  return messages[key] ? key : 'en'
}
