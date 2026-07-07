export interface UploadStatus {
  status: "sem_dados" | "processando" | "sucesso" | "erro"
  nome_arquivo?: string
  total_registros?: number
  processado_em?: string
  erros?: string[]
}

export interface ColunaVisivel {
  key:   string
  label: string
}

export interface BaseConfig {
  id:               string
  label:            string
  descricao:        string
  colunas:          string[]
  template:         string
  icone:            string
  colunasVisiveis?: ColunaVisivel[]   // quando definido, restringe e renomeia colunas na tabela
}

export interface OrcadoLiberacaoMes {
  mes:          number
  L1:           number
  L2:           number
  L1_heranca?:  number
  L2_heranca?:  number
}

export interface OrcadoLiberacaoData {
  meses:                   OrcadoLiberacaoMes[]
  total_l1_tubetes:        number
  total_l2_tubetes:        number
  total_tubetes:           number
  total_l1_caixas:         number
  total_l2_caixas:         number
  total_caixas:            number
  heranca_2025_tubetes:    number
  heranca_2025_caixas:     number
  producao_2026_caixas:    number
}

export interface MesGrafico {
  mes:                string
  estoqueInicio:      number
  entradasReais:      number
  entradasProjetadas: number
  forecast:           number
  faturamentoReal:    number
}
