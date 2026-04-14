import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import {
  CONFIG_TEMPLATES,
  PRETRAINED,
  GPT_SOVITS_ROOT,
  TEMP_DIR,
  WEIGHT_DIRS,
} from '../config.js';

export function generateSoVITSConfig({ expName, batchSize = 2, epochs = 20, saveEveryEpoch = 4 }) {
  const template = JSON.parse(fs.readFileSync(CONFIG_TEMPLATES.sovits, 'utf-8'));

  // Use relative paths (relative to GPT_SOVITS_ROOT cwd), matching webui.py
  const s2Dir = `logs/${expName}`;

  template.train.batch_size = batchSize;
  template.train.epochs = epochs;
  template.train.text_low_lr_rate = 0.4;
  template.train.pretrained_s2G = PRETRAINED.sovitsG;
  template.train.pretrained_s2D = PRETRAINED.sovitsD;
  template.train.if_save_latest = true;
  template.train.if_save_every_weights = true;
  template.train.save_every_epoch = saveEveryEpoch;
  template.train.gpu_numbers = '0';
  template.train.grad_ckpt = false;

  template.model = template.model || {};
  template.model.version = 'v2';

  template.data = template.data || {};
  template.data.exp_dir = s2Dir;

  template.s2_ckpt_dir = s2Dir;
  template.save_weight_dir = WEIGHT_DIRS.sovits;
  template.name = expName;
  template.version = 'v2';

  // Ensure the logs_s2_v2 subdir exists (webui.py line 389)
  const logsS2Dir = path.join(GPT_SOVITS_ROOT, s2Dir, 'logs_s2_v2');
  fs.mkdirSync(logsS2Dir, { recursive: true });

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(WEIGHT_DIRS.sovits, { recursive: true });
  const configPath = path.join(TEMP_DIR, `tmp_s2_${expName}_${crypto.randomUUID()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(template, null, 2));

  return configPath;
}

export function generateGPTConfig({ expName, batchSize = 2, epochs = 25, saveEveryEpoch = 5 }) {
  const templateStr = fs.readFileSync(CONFIG_TEMPLATES.gpt, 'utf-8');
  const template = yaml.load(templateStr);

  template.train = template.train || {};
  template.train.batch_size = batchSize;
  template.train.epochs = epochs;
  template.train.save_every_n_epoch = saveEveryEpoch;
  template.train.if_save_every_weights = true;
  template.train.if_save_latest = true;
  template.train.if_dpo = false;
  template.train.half_weights_save_dir = WEIGHT_DIRS.gpt;
  template.train.exp_name = expName;

  template.pretrained_s1 = PRETRAINED.gpt;
  template.train_semantic_path = `logs/${expName}/6-name2semantic.tsv`;
  template.train_phoneme_path = `logs/${expName}/2-name2text.txt`;
  template.output_dir = `logs/${expName}/logs_s1_v2`;

  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(WEIGHT_DIRS.gpt, { recursive: true });
  const configPath = path.join(TEMP_DIR, `tmp_s1_${expName}_${crypto.randomUUID()}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(template, { lineWidth: -1 }));

  return configPath;
}
