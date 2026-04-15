import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import yaml from 'js-yaml';
import {
  CONFIG_TEMPLATES,
  PRETRAINED,
  GPT_SOVITS_ROOT,
  LOCAL_TEMP_ROOT,
} from '../config.js';

export function generateSoVITSConfig({ expName, batchSize = 2, epochs = 20, saveEveryEpoch = 4, weightsDir }) {
  const template = JSON.parse(fs.readFileSync(CONFIG_TEMPLATES.sovits, 'utf-8'));

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
  template.save_weight_dir = weightsDir;
  template.name = expName;
  template.version = 'v2';

  const logsS2Dir = path.join(GPT_SOVITS_ROOT, s2Dir, 'logs_s2_v2');
  fs.mkdirSync(logsS2Dir, { recursive: true });

  fs.mkdirSync(LOCAL_TEMP_ROOT, { recursive: true });
  fs.mkdirSync(weightsDir, { recursive: true });
  const configPath = path.join(LOCAL_TEMP_ROOT, `tmp_s2_${expName}_${crypto.randomUUID()}.json`);
  fs.writeFileSync(configPath, JSON.stringify(template, null, 2));

  return configPath;
}

export function generateGPTConfig({ expName, batchSize = 2, epochs = 25, saveEveryEpoch = 5, weightsDir }) {
  const templateStr = fs.readFileSync(CONFIG_TEMPLATES.gpt, 'utf-8');
  const template = yaml.load(templateStr);

  template.train = template.train || {};
  template.train.batch_size = batchSize;
  template.train.epochs = epochs;
  template.train.save_every_n_epoch = saveEveryEpoch;
  template.train.if_save_every_weights = true;
  template.train.if_save_latest = true;
  template.train.if_dpo = false;
  template.train.half_weights_save_dir = weightsDir;
  template.train.exp_name = expName;

  template.pretrained_s1 = PRETRAINED.gpt;
  template.train_semantic_path = `logs/${expName}/6-name2semantic.tsv`;
  template.train_phoneme_path = `logs/${expName}/2-name2text.txt`;
  template.output_dir = `logs/${expName}/logs_s1_v2`;

  fs.mkdirSync(LOCAL_TEMP_ROOT, { recursive: true });
  fs.mkdirSync(weightsDir, { recursive: true });
  const configPath = path.join(LOCAL_TEMP_ROOT, `tmp_s1_${expName}_${crypto.randomUUID()}.yaml`);
  fs.writeFileSync(configPath, yaml.dump(template, { lineWidth: -1 }));

  return configPath;
}
