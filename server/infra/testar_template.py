#!/usr/bin/env python3
"""Testes do template CloudFormation: afirmam as propriedades criticas.

Uso: uvx --with pyyaml python -I server/infra/testar_template.py
Le o YAML (com as tags !Ref, !Sub, ...) sem tocar na AWS.
"""
import unittest
from pathlib import Path

import yaml

TEMPLATE = Path(__file__).resolve().parent / "saude-familiar.yaml"


def carregar():
    class L(yaml.SafeLoader):
        pass

    def tag(loader, sufixo, no):
        if isinstance(no, yaml.ScalarNode):
            v = loader.construct_scalar(no)
        elif isinstance(no, yaml.SequenceNode):
            v = loader.construct_sequence(no, deep=True)
        else:
            v = loader.construct_mapping(no, deep=True)
        nome = "Ref" if sufixo == "Ref" else "Fn::" + sufixo
        if sufixo == "GetAtt" and isinstance(v, str):
            v = v.split(".", 1)
        return {nome: v}

    L.add_multi_constructor("!", tag)
    return yaml.load(TEMPLATE.read_text(encoding="utf-8"), Loader=L)


T = carregar()
R = T["Resources"]


def props(nome):
    return R[nome]["Properties"]


class Template(unittest.TestCase):
    def test_parametros(self):
        p = T["Parameters"]
        self.assertEqual(p["TipoInstancia"]["Default"], "t4g.micro")
        self.assertEqual(p["TipoInstancia"]["AllowedValues"], ["t4g.micro", "t4g.small"])
        self.assertEqual(p["AmiId"]["Type"], "AWS::EC2::Image::Id")
        self.assertEqual(p["AmiId"]["Default"], "ami-09c4af6de8b9844f6")
        self.assertTrue(p["SegredoOrigemTeste"]["NoEcho"])
        self.assertTrue(p["SegredoOrigemProducao"]["NoEcho"])
        self.assertEqual(str(p["LimiteOrcamentoUSD"]["Default"]), "20")
        self.assertIn("EmailAlerta", p)

    def test_recursos_esperados(self):
        esperados = {"GrupoSeguranca", "PapelMaquina", "PerfilMaquina", "Maquina", "IpFixo",
                     "AssociacaoIp", "BucketFotos", "BucketBackups", "TopicoAlertas",
                     "AssinaturaAlertas", "Orcamento", "AlarmeRecuperacao", "AlarmeTravada",
                     "CloudFrontTeste", "CloudFrontProducao"}
        self.assertEqual(set(R), esperados)

    def test_sem_waf_nem_ssh(self):
        self.assertFalse([k for k, v in R.items() if "WAF" in v["Type"].upper()])
        ing = props("GrupoSeguranca")["SecurityGroupIngress"]
        self.assertFalse([r for r in ing if r["FromPort"] <= 22 <= r["ToPort"]])

    def test_security_group(self):
        ing = props("GrupoSeguranca")["SecurityGroupIngress"]
        self.assertEqual(len(ing), 2)
        r443 = [r for r in ing if r["FromPort"] == 443][0]
        self.assertEqual(r443["SourcePrefixListId"], "pl-b6a144df")
        self.assertNotIn("CidrIp", r443)
        r80 = [r for r in ing if r["FromPort"] == 80][0]
        self.assertEqual(r80["CidrIp"], "0.0.0.0/0")
        # saida padrao (tudo liberado) fica por conta da AWS
        self.assertNotIn("SecurityGroupEgress", props("GrupoSeguranca"))

    def test_maquina(self):
        m = props("Maquina")
        self.assertEqual(m["MetadataOptions"]["HttpTokens"], "required")
        self.assertTrue(m["DisableApiTermination"])
        self.assertEqual(m["ImageId"], {"Ref": "AmiId"})
        bd = m["BlockDeviceMappings"][0]
        self.assertEqual(bd["DeviceName"], "/dev/sda1")
        ebs = bd["Ebs"]
        self.assertEqual(ebs["VolumeType"], "gp3")
        self.assertEqual(ebs["VolumeSize"], 20)
        self.assertTrue(ebs["Encrypted"])
        self.assertIn({"Key": "Name", "Value": "saude-familiar"}, m["Tags"])
        # o Postgres mora no disco raiz: nada de apagar junto com a instancia
        self.assertEqual(R["Maquina"]["DeletionPolicy"], "Retain")
        self.assertEqual(R["Maquina"]["UpdateReplacePolicy"], "Retain")
        self.assertIs(ebs["DeleteOnTermination"], False)

    def test_buckets(self):
        for nome in ("BucketFotos", "BucketBackups"):
            b = props(nome)
            self.assertEqual(R[nome]["DeletionPolicy"], "Retain")
            self.assertEqual(b["PublicAccessBlockConfiguration"], {
                "BlockPublicAcls": True, "BlockPublicPolicy": True,
                "IgnorePublicAcls": True, "RestrictPublicBuckets": True})
            sse = b["BucketEncryption"]["ServerSideEncryptionConfiguration"][0]
            self.assertEqual(sse["ServerSideEncryptionByDefault"]["SSEAlgorithm"], "AES256")
        f = props("BucketFotos")
        self.assertEqual(f["OwnershipControls"]["Rules"][0]["ObjectOwnership"], "BucketOwnerEnforced")
        self.assertEqual(f["VersioningConfiguration"]["Status"], "Enabled")
        regras = f["LifecycleConfiguration"]["Rules"]
        self.assertTrue(any(r.get("NoncurrentVersionExpiration", {}).get("NoncurrentDays") == 30
                            for r in regras))
        self.assertTrue(any(r.get("ExpiredObjectDeleteMarker") is True for r in regras))
        self.assertTrue(any(r.get("AbortIncompleteMultipartUpload", {}).get("DaysAfterInitiation") == 1
                            for r in regras))
        self.assertTrue(all(r["Status"] == "Enabled" for r in regras))
        cors = f["CorsConfiguration"]["CorsRules"][0]
        self.assertEqual(sorted(cors["AllowedMethods"]), ["GET", "POST"])
        self.assertEqual(sorted(cors["AllowedOrigins"]),
                         ["http://localhost:*", "https://kaique-fhs.github.io"])
        bk = props("BucketBackups")
        # versionado: sem isso, PutObject da maquina sobrescreveria os dumps sem deixar copia
        self.assertEqual(bk["VersioningConfiguration"]["Status"], "Enabled")
        regras_bk = bk["LifecycleConfiguration"]["Rules"]
        # promessa da politica de privacidade: o backup some em ate 30 dias no total
        # (com versionamento, a expiracao atual so cria uma versao antiga, que espera mais)
        atual = [r["ExpirationInDays"] for r in regras_bk if "ExpirationInDays" in r]
        antiga = [r["NoncurrentVersionExpiration"]["NoncurrentDays"] for r in regras_bk
                  if "NoncurrentVersionExpiration" in r]
        self.assertEqual(len(atual), 1)
        self.assertEqual(len(antiga), 1)
        self.assertLessEqual(atual[0] + antiga[0], 30)
        self.assertTrue(any(r.get("ExpiredObjectDeleteMarker") is True for r in regras_bk))
        self.assertTrue(all(r["Status"] == "Enabled" for r in regras_bk))

    def test_papel(self):
        p = props("PapelMaquina")
        self.assertIn("arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore", p["ManagedPolicyArns"])
        stm = p["Policies"][0]["PolicyDocument"]["Statement"]
        acoes = set()
        for s in stm:
            self.assertEqual(s["Effect"], "Allow")
            self.assertNotEqual(s["Resource"], "*")
            acoes |= set(s["Action"] if isinstance(s["Action"], list) else [s["Action"]])
        self.assertEqual(acoes, {
            "s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:ListBucketVersions",
            "s3:DeleteObject", "s3:DeleteObjectVersion",
            "ssm:GetParameter", "ssm:GetParameters", "ssm:GetParametersByPath", "sns:Publish"})
        self.assertIn("parameter/saude-familiar/", str(stm))
        # backups: a maquina nao apaga nada (expiracao fica com o lifecycle)
        for s in stm:
            if "BucketBackups" in str(s["Resource"]):
                for a in (s["Action"] if isinstance(s["Action"], list) else [s["Action"]]):
                    self.assertNotIn("Delete", a)
        self.assertNotIn("s3:ListBucketVersions", str([s for s in stm if "BucketBackups" in str(s["Resource"])]))

    def test_cloudfront(self):
        for nome, segredo, caminho in (("CloudFrontTeste", "SegredoOrigemTeste", "/teste"),
                                       ("CloudFrontProducao", "SegredoOrigemProducao", "")):
            c = props(nome)["DistributionConfig"]
            self.assertEqual(c["PriceClass"], "PriceClass_100")
            self.assertNotIn("WebACLId", c)
            o = c["Origins"][0]
            self.assertEqual(o["DomainName"], {"Fn::Sub": "${IpFixo}.sslip.io"})
            self.assertEqual(o.get("OriginPath", ""), caminho)
            self.assertEqual(o["CustomOriginConfig"]["OriginProtocolPolicy"], "https-only")
            self.assertEqual(o["CustomOriginConfig"]["OriginSSLProtocols"], ["TLSv1.2"])
            h = o["OriginCustomHeaders"][0]
            self.assertEqual(h["HeaderName"], "x-saude-origem")
            self.assertEqual(h["HeaderValue"], {"Ref": segredo})
            d = c["DefaultCacheBehavior"]
            self.assertEqual(d["CachePolicyId"], "4135ea2d-6df8-44a3-9df3-4b5a84be39ad")
            self.assertEqual(d["OriginRequestPolicyId"], "b689b0a8-53d0-40ab-baf2-68738e2966ac")
            self.assertEqual(d["ViewerProtocolPolicy"], "https-only")
            self.assertEqual(sorted(d["AllowedMethods"]),
                             sorted(["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"]))

    def test_alarme_orcamento_saidas(self):
        a = props("AlarmeRecuperacao")
        self.assertEqual(a["MetricName"], "StatusCheckFailed_System")
        self.assertEqual(a["Period"] * a["EvaluationPeriods"], 120)
        self.assertEqual(a["Threshold"], 1)
        self.assertEqual(a["ComparisonOperator"], "GreaterThanOrEqualToThreshold")
        self.assertIn({"Fn::Sub": "arn:aws:automate:${AWS::Region}:ec2:recover"}, a["AlarmActions"])
        t = props("AlarmeTravada")
        self.assertEqual(t["MetricName"], "StatusCheckFailed_Instance")
        self.assertEqual(t["Namespace"], "AWS/EC2")
        self.assertEqual(t["Threshold"], 1)
        self.assertEqual(t["ComparisonOperator"], "GreaterThanOrEqualToThreshold")
        self.assertEqual(t["Dimensions"], [{"Name": "InstanceId", "Value": {"Ref": "Maquina"}}])
        self.assertIn({"Fn::Sub": "arn:aws:automate:${AWS::Region}:ec2:reboot"}, t["AlarmActions"])
        self.assertIn({"Ref": "TopicoAlertas"}, t["AlarmActions"])
        self.assertTrue(t["Period"] * t["EvaluationPeriods"] >= 300)
        b = props("Orcamento")["Budget"]
        self.assertEqual(b["BudgetType"], "COST")
        self.assertEqual(b["TimeUnit"], "MONTHLY")
        self.assertIs(b.get("CostTypes", {}).get("IncludeCredit"), False,
                      "com credito incluido o alerta nao dispara enquanto houver credito")
        ns = {(n["Notification"]["NotificationType"], n["Notification"]["Threshold"])
              for n in props("Orcamento")["NotificationsWithSubscribers"]}
        self.assertEqual(ns, {("ACTUAL", 80), ("FORECASTED", 100)})
        self.assertEqual(set(T["Outputs"]), {
            "IpPublico", "NomeOrigem", "UrlTeste", "UrlProducao", "BucketFotos",
            "BucketBackups", "IdMaquina", "TopicoAlertas"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
